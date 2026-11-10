using System;
using System.Linq;
using UnityEngine;
using UnityEngine.Networking;
using Warudo.Core;
using Warudo.Core.Attributes;
using Warudo.Core.Graphs;
using Warudo.Core.Scenes;

// Warudo only consumes the HTTP API. This file never opens a MIDI device.
[AssetType(Id = "d5df6826-cbba-48fd-9863-ad117e34aa13", Title = "MIDI API Leap Motion Gate", Category = "CATEGORY_EXTERNAL_INTEGRATION", Singleton = true)]
public class MidiApiLeapMotionGate : Asset {
    [DataInput]
    public string ApiUrl = "http://127.0.0.1:19100/v1/state?consumer=warudo";

    [DataInput]
    public string TrackingBlueprintName = "Pose Tracking - Leap Motion";

    [DataInput]
    [Description("Seconds to blend from the idle pose into Leap Motion tracking.")]
    public float FadeInSeconds = 0.25f;

    [DataInput]
    [Description("Seconds to blend back to the idle pose after releasing the last pad.")]
    public float FadeOutSeconds = 0.4f;

    [Markdown]
    public string Status = "Waiting for MIDI API";

    [Serializable]
    private class ApiState {
        public int schemaVersion;
        public bool connected;
        public bool trackingEnabled;
    }

    private UnityWebRequest request;
    private Graph controlledGraph;
    private Node[] transitionNodes = new Node[0];
    private bool graphReady;
    private string graphError;
    private float appliedFadeIn = float.NaN;
    private float appliedFadeOut = float.NaN;
    private float requestStarted;
    private float nextPoll;
    private float lastResponse = float.NegativeInfinity;
    private bool requestedTracking;
    private string connectionStatus = "Waiting for MIDI API";
    private const float PollSeconds = 0.03f;
    private const float FailClosedSeconds = 0.5f;

    // Conditions are consumed by Warudo's existing eased transition nodes.
    public bool TrackingAllowed { get; private set; }

    private void ConfigureGraph(Graph graph) {
        const string leapReaderType = "1f534893-b790-4472-be13-51f85bc95d36";
        var readers = graph.GetNodes().Values.Where(n => n.GetTypeMeta().Id == leapReaderType).ToArray();
        if (readers.Length != 1) throw new InvalidOperationException("Expected exactly one Leap Motion data node");
        var reader = readers[0];
        var connections = graph.GetInputDataConnections().Values.SelectMany(p => p.Values).SelectMany(p => p).ToArray();
        var conditions = connections.Where(c => c.InputPort.Key == "Condition" &&
            (c.OutputNode == reader || c.OutputNode is MidiApiTrackingCondition)).ToArray();
        if (conditions.Length == 0) throw new InvalidOperationException("No Leap Motion transition conditions found");

        foreach (var connection in conditions) {
            var gate = connection.OutputNode as MidiApiTrackingCondition;
            if (gate == null) {
                var sourcePort = connection.OutputPort.Key;
                if (sourcePort != "IsTracked" && sourcePort != "IsLeftHandTracked" && sourcePort != "IsRightHandTracked") continue;
                gate = graph.GetNodes().Values.OfType<MidiApiTrackingCondition>().FirstOrDefault(n => n.Name == "Launchpad Hold - " + sourcePort);
                if (gate == null) {
                    gate = graph.AddNode<MidiApiTrackingCondition>();
                    gate.Name = "Launchpad Hold - " + sourcePort;
                    gate.GraphPosition = reader.GraphPosition + new Vector2(350f, graph.GetNodes().Values.OfType<MidiApiTrackingCondition>().Count() * 180f);
                    if (!graph.AddDataConnection(reader, sourcePort, gate, nameof(gate.Tracked))) {
                        throw new InvalidOperationException("Could not connect Leap Motion condition");
                    }
                }
                gate.SetDataInput(nameof(gate.Gate), this, broadcast: true);
                graph.RemoveDataConnection(connection, false);
                if (!graph.AddDataConnection(gate, nameof(gate.Allowed), connection.InputNode, connection.InputPort.Key)) {
                    graph.AddDataConnection(reader, sourcePort, connection.InputNode, connection.InputPort.Key);
                    throw new InvalidOperationException("Could not connect tracking transition");
                }
            } else {
                gate.SetDataInput(nameof(gate.Gate), this, broadcast: true);
            }
        }

        transitionNodes = conditions.Select(c => c.InputNode).Distinct().Where(n =>
            n.GetDataInputPort("ToTrueTransitionTime") != null && n.GetDataInputPort("ToFalseTransitionTime") != null).ToArray();
        if (transitionNodes.Length == 0) throw new InvalidOperationException("No eased transition nodes found");
        appliedFadeIn = appliedFadeOut = float.NaN;
        ApplyTransitionTimes();
        graph.Enabled = true;
        Context.Service.BroadcastOpenedScene();
    }

    private static float Duration(float value, float fallback) {
        return float.IsNaN(value) || float.IsInfinity(value) ? fallback : Math.Max(0f, Math.Min(5f, value));
    }

    private void ApplyTransitionTimes() {
        var fadeIn = Duration(FadeInSeconds, 0.25f);
        var fadeOut = Duration(FadeOutSeconds, 0.4f);
        if (fadeIn == appliedFadeIn && fadeOut == appliedFadeOut) return;
        foreach (var node in transitionNodes) {
            node.SetDataInput("ToTrueTransitionTime", fadeIn, broadcast: true);
            node.SetDataInput("ToFalseTransitionTime", fadeOut, broadcast: true);
        }
        appliedFadeIn = fadeIn;
        appliedFadeOut = fadeOut;
    }

    protected override void OnCreate() {
        base.OnCreate();
        SetActive(true);
    }

    public override void OnUpdate() {
        base.OnUpdate();
        var now = Time.realtimeSinceStartup;
        var matches = Context.OpenedScene.GetGraphs().Values.Where(g => g.Name == TrackingBlueprintName).ToArray();
        var graph = matches.Length == 1 ? matches[0] : null;
        if (controlledGraph != graph) {
            if (controlledGraph != null) controlledGraph.Enabled = false;
            controlledGraph = graph;
            requestedTracking = false;
            lastResponse = float.NegativeInfinity;
            TrackingAllowed = false;
            graphReady = false;
            graphError = null;
            transitionNodes = new Node[0];
            if (graph != null) {
                try {
                    ConfigureGraph(graph);
                    graphReady = true;
                } catch (Exception error) {
                    graph.Enabled = false;
                    graphError = error.Message;
                }
            }
        }

        if (request != null) {
            if (request.isDone) {
                try {
                    if (request.result != UnityWebRequest.Result.Success) throw new Exception("API unavailable");
                    var state = JsonUtility.FromJson<ApiState>(request.downloadHandler.text);
                    if (state == null || state.schemaVersion != 1) throw new Exception("Invalid API response");
                    requestedTracking = state.connected && state.trackingEnabled;
                    lastResponse = now;
                    connectionStatus = state.connected ? (requestedTracking ? "Tracking ON (held)" : "Tracking OFF (released)") : "Tracking OFF (MIDI disconnected)";
                } catch {
                    requestedTracking = false;
                    connectionStatus = "Tracking OFF (API unavailable)";
                }
                request.Dispose();
                request = null;
                nextPoll = now + PollSeconds;
            } else if (now - requestStarted >= FailClosedSeconds) {
                CancelRequest();
                requestedTracking = false;
                connectionStatus = "Tracking OFF (API timeout)";
                nextPoll = now + PollSeconds;
            }
        }

        if (request == null && now >= nextPoll) {
            Uri uri;
            if (!Uri.TryCreate(ApiUrl, UriKind.Absolute, out uri) || uri.Scheme != "http" ||
                !(uri.Host == "127.0.0.1" || uri.Host == "localhost" || uri.Host == "[::1]" || uri.Host == "::1")) {
                requestedTracking = false;
                connectionStatus = "Tracking OFF (local HTTP API URL required)";
                nextPoll = now + 1f;
            } else {
                try {
                    request = UnityWebRequest.Get(ApiUrl);
                    request.timeout = 1;
                    request.redirectLimit = 0;
                    request.SendWebRequest();
                    requestStarted = now;
                } catch {
                    CancelRequest();
                    requestedTracking = false;
                    connectionStatus = "Tracking OFF (API unavailable)";
                    nextPoll = now + 0.5f;
                }
            }
        }

        bool fresh = now - lastResponse < FailClosedSeconds;
        TrackingAllowed = graphReady && requestedTracking && fresh;
        if (graphReady) {
            ApplyTransitionTimes();
            // Keep updating while released so the native bone-weight and IK transitions can finish.
            controlledGraph.Enabled = true;
        }
        string status = controlledGraph == null ? "Tracking OFF: select exactly one existing Leap Motion blueprint by name" :
            graphError != null ? "Tracking OFF: " + graphError : connectionStatus;
        if (Status != status) SetDataInput(nameof(Status), status, broadcast: true);
    }

    private void CancelRequest() {
        if (request == null) return;
        request.Abort();
        request.Dispose();
        request = null;
    }

    protected override void OnDestroy() {
        CancelRequest();
        TrackingAllowed = false;
        base.OnDestroy();
    }
}

[NodeType(Id = "6fc12330-a22a-46f7-afc6-770be98e0983", Title = "MIDI API Tracking Condition", Category = "CATEGORY_EXTERNAL_INTEGRATION")]
public class MidiApiTrackingCondition : Node {
    [DataInput]
    public MidiApiLeapMotionGate Gate;

    [DataInput]
    public bool Tracked;

    [DataOutput]
    public bool Allowed() {
        return Gate != null && Gate.TrackingAllowed && Tracked;
    }
}
