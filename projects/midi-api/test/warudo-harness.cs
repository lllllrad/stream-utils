// Local test doubles only: this executable never opens Warudo or any MIDI device.
using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Networking;
using Warudo.Core;
using Warudo.Core.Graphs;

public static class WarudoHarness {
    private static void Check(bool condition, string message) {
        if (!condition) throw new Exception(message);
    }
    private static void Step(MidiApiLeapMotionGate gate, string json) {
        UnityWebRequest.Response = json;
        for (int i = 0; i < 4; i++) { Time.realtimeSinceStartup += 0.05f; gate.OnUpdate(); }
    }
    public static int Main() {
        try {
            var graph = new Graph { Name = "Pose Tracking - Leap Motion" };
            Context.OpenedScene.Graphs.Add(Guid.NewGuid(), graph);
            var reader = new Node { TypeId = "1f534893-b790-4472-be13-51f85bc95d36" };
            graph.Nodes.Add(Guid.NewGuid(), reader);
            foreach (var source in new[] { "IsLeftHandTracked", "IsRightHandTracked", "IsTracked", "IsTracked" }) {
                var target = new Node();
                target.Inputs["ToTrueTransitionTime"] = 0.4f;
                target.Inputs["ToFalseTransitionTime"] = 0.4f;
                graph.Nodes.Add(Guid.NewGuid(), target);
                graph.AddDataConnection(reader, source, target, "Condition");
            }
            var gate = new MidiApiLeapMotionGate();
            const string held = "{\"schemaVersion\":1,\"connected\":true,\"trackingEnabled\":true}";
            const string released = "{\"schemaVersion\":1,\"connected\":true,\"trackingEnabled\":false}";
            Step(gate, released);
            var wrappers = graph.Nodes.Values.OfType<MidiApiTrackingCondition>().ToArray();
            Check(wrappers.Length == 3, "Three hand-aware condition gates are required");
            Check(graph.Connections.Count == 7, "All four transitions must be routed through the gates");
            Check(graph.Connections.Count(c => c.InputPort.Key == "Condition" && c.OutputNode is MidiApiTrackingCondition) == 4,
                "No transition may bypass the gate");
            Check(graph.Enabled && !gate.TrackingAllowed, "Released graph must keep updating its native fade");
            foreach (var node in graph.Nodes.Values.Where(n => n.Inputs.ContainsKey("ToTrueTransitionTime"))) {
                Check((float)node.Inputs["ToTrueTransitionTime"] == 0.25f && (float)node.Inputs["ToFalseTransitionTime"] == 0.4f,
                    "Attack and release durations must be applied to all transition nodes");
            }
            Step(gate, held);
            Check(gate.TrackingAllowed, "Held API response must open tracking");
            foreach (var wrapper in wrappers) {
                wrapper.Tracked = false;
                Check(!wrapper.Allowed(), "A held pad must not fake sensor tracking");
                wrapper.Tracked = true;
                Check(wrapper.Allowed(), "Tracked hands must enter the native eased transition");
            }
            Step(gate, released);
            Check(!gate.TrackingAllowed && graph.Enabled && wrappers.All(w => !w.Allowed()), "Release must fade out without disabling the graph");
            gate.FadeInSeconds = 0.7f;
            gate.FadeOutSeconds = 0.9f;
            Step(gate, released);
            Check(graph.Nodes.Values.Where(n => n.Inputs.ContainsKey("ToTrueTransitionTime"))
                .All(n => (float)n.Inputs["ToTrueTransitionTime"] == 0.7f && (float)n.Inputs["ToFalseTransitionTime"] == 0.9f),
                "Live duration changes must reach all transition nodes");

            // Saved/reloaded scenes already contain the gates: rebind, never duplicate.
            var reloadedGate = new MidiApiLeapMotionGate();
            Step(reloadedGate, held);
            Check(graph.Nodes.Values.OfType<MidiApiTrackingCondition>().Count() == 3 && graph.Connections.Count == 7,
                "Reload must be idempotent");
            Check(wrappers.All(w => w.Gate == reloadedGate && w.Allowed()), "Reload must bind gates to the current asset");
            Step(reloadedGate, "bad response");
            Check(!reloadedGate.TrackingAllowed && graph.Enabled, "API failure must smoothly close tracking");
            Step(reloadedGate, held);
            UnityWebRequest.Pending = true;
            Step(reloadedGate, held);
            Time.realtimeSinceStartup += 0.6f;
            reloadedGate.OnUpdate();
            Check(!reloadedGate.TrackingAllowed && graph.Enabled, "Stale API state must close tracking while fades run");
            Console.WriteLine("Warudo harness passed: eased wiring, hand tracking, release, duration updates, reload and API failure.");
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}

namespace UnityEngine {
    public struct Vector2 {
        public Vector2(float x, float y) { }
        public static Vector2 operator +(Vector2 a, Vector2 b) { return a; }
    }
    public static class Time { public static float realtimeSinceStartup; }
    public static class JsonUtility {
        public static T FromJson<T>(string json) {
            if (!json.StartsWith("{")) throw new Exception("Bad JSON");
            var value = Activator.CreateInstance(typeof(T), true);
            foreach (var field in typeof(T).GetFields()) {
                object data = field.FieldType == typeof(int) ? (object)(json.Contains("\"schemaVersion\":1") ? 1 : 0) : json.Contains("\"" + field.Name + "\":true");
                field.SetValue(value, data);
            }
            return (T)value;
        }
    }
}
namespace UnityEngine.Networking {
    public class DownloadHandler { public string text; }
    public class UnityWebRequest : IDisposable {
        public enum Result { Success, ConnectionError }
        public static string Response = "{}";
        public static bool Pending;
        public bool isDone;
        public Result result = Result.Success;
        public DownloadHandler downloadHandler;
        public int timeout, redirectLimit;
        public static UnityWebRequest Get(string url) {
            return new UnityWebRequest { isDone = !Pending, downloadHandler = new DownloadHandler { text = Response } };
        }
        public void SendWebRequest() { }
        public void Abort() { }
        public void Dispose() { }
    }
}
namespace Warudo.Core.Attributes {
    public class DataInputAttribute : Attribute { }
    public class DataOutputAttribute : Attribute { }
    public class MarkdownAttribute : Attribute { }
    public class DescriptionAttribute : Attribute { public DescriptionAttribute(string text) { } }
    public class AssetTypeAttribute : Attribute { public string Id, Title, Category; public bool Singleton; }
    public class NodeTypeAttribute : Attribute { public string Id, Title, Category; }
}
namespace Warudo.Core.Scenes {
    public class Asset {
        protected virtual void OnCreate() { }
        protected virtual void OnDestroy() { }
        public virtual void OnUpdate() { }
        public void SetActive(bool active) { }
        public void SetDataInput(string key, object value, bool broadcast) { GetType().GetField(key).SetValue(this, value); }
    }
    public class Scene {
        public Dictionary<Guid, Graph> Graphs = new Dictionary<Guid, Graph>();
        public Dictionary<Guid, Graph> GetGraphs() { return Graphs; }
    }
}
namespace Warudo.Core {
    public static class Context {
        public static Warudo.Core.Scenes.Scene OpenedScene = new Warudo.Core.Scenes.Scene();
        public static FakeService Service = new FakeService();
    }
    public class FakeService { public void BroadcastOpenedScene() { } }
}
namespace Warudo.Core.Graphs {
    public class Port { public string Key; }
    public class Meta { public string Id; }
    public class Node {
        public string TypeId, Name;
        public Vector2 GraphPosition;
        public readonly Dictionary<string, object> Inputs = new Dictionary<string, object>();
        public Meta GetTypeMeta() { return new Meta { Id = TypeId }; }
        public Port GetDataInputPort(string key) { return Inputs.ContainsKey(key) ? new Port { Key = key } : null; }
        public void SetDataInput(string key, object value, bool broadcast) {
            var field = GetType().GetField(key);
            if (field != null) field.SetValue(this, value); else Inputs[key] = value;
        }
    }
    public class DataConnection { public Node OutputNode, InputNode; public Port OutputPort, InputPort; }
    public class Graph {
        public string Name;
        public bool Enabled;
        public Dictionary<Guid, Node> Nodes = new Dictionary<Guid, Node>();
        public List<DataConnection> Connections = new List<DataConnection>();
        public Dictionary<Guid, Node> GetNodes() { return Nodes; }
        public Dictionary<Guid, Dictionary<string, List<DataConnection>>> GetInputDataConnections() {
            return new Dictionary<Guid, Dictionary<string, List<DataConnection>>> {
                { Guid.Empty, new Dictionary<string, List<DataConnection>> { { "all", Connections } } }
            };
        }
        public T AddNode<T>() where T : Node, new() { var node = new T(); Nodes.Add(Guid.NewGuid(), node); return node; }
        public bool AddDataConnection(Node source, string sourcePort, Node target, string targetPort) {
            Connections.Add(new DataConnection { OutputNode = source, InputNode = target, OutputPort = new Port { Key = sourcePort }, InputPort = new Port { Key = targetPort } });
            return true;
        }
        public void RemoveDataConnection(DataConnection connection, bool reset) { Connections.Remove(connection); }
    }
}
