using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

namespace StreamUtils {
    public static class LaunchpadLeds {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct Caps {
            public ushort manufacturer, product;
            public uint version;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string name;
            public ushort technology, voices, notes, channels;
            public uint support;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct Header {
            public IntPtr data;
            public uint length, recorded;
            public UIntPtr user;
            public uint flags;
            public IntPtr next;
            public UIntPtr reserved;
            public uint offset;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)] public UIntPtr[] extra;
        }
        [DllImport("winmm.dll")] private static extern uint midiOutGetNumDevs();
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)] private static extern uint midiOutGetDevCapsW(UIntPtr id, out Caps caps, uint size);
        [DllImport("winmm.dll")] private static extern uint midiOutOpen(out IntPtr handle, uint id, IntPtr callback, IntPtr instance, uint flags);
        [DllImport("winmm.dll")] private static extern uint midiOutPrepareHeader(IntPtr handle, IntPtr header, uint size);
        [DllImport("winmm.dll")] private static extern uint midiOutLongMsg(IntPtr handle, IntPtr header, uint size);
        [DllImport("winmm.dll")] private static extern uint midiOutUnprepareHeader(IntPtr handle, IntPtr header, uint size);
        [DllImport("winmm.dll")] private static extern uint midiOutReset(IntPtr handle);
        [DllImport("winmm.dll")] private static extern uint midiOutClose(IntPtr handle);
        private static void Check(uint code) { if (code != 0) throw new InvalidOperationException("WinMM LED error " + code); }

        public static byte[] Encode(byte red, byte green, byte blue) {
            if (red > 63 || green > 63 || blue > 63) throw new ArgumentOutOfRangeException("RGB components must be 0..63");
            var data = new List<byte>(new byte[] { 240, 0, 32, 41, 2, 24, 11 });
            for (int row = 1; row <= 9; row++) for (int col = 1; col <= (row == 9 ? 8 : 9); col++) {
                data.Add((byte)(row * 10 + col)); data.Add(red); data.Add(green); data.Add(blue);
            }
            data.Add(247);
            return data.ToArray();
        }

        public static void Identify(string trackingInputName) {
            var outputs = new Dictionary<uint, string>();
            uint count = midiOutGetNumDevs();
            for (uint id = 0; id < count; id++) {
                Caps caps;
                Check(midiOutGetDevCapsW(new UIntPtr(id), out caps, (uint)Marshal.SizeOf(typeof(Caps))));
                if (caps.name != null && caps.name.EndsWith("Launchpad MK2", StringComparison.Ordinal)) outputs.Add(id, caps.name);
            }
            int matchingOutputs = 0;
            foreach (var name in outputs.Values) if (name == trackingInputName) matchingOutputs++;
            if (matchingOutputs != 1) throw new InvalidOperationException("Expected exactly one matching Launchpad MK2 output for selected input");
            if (outputs.Count > 2) throw new InvalidOperationException("LED identification requires at most two Launchpad MK2 outputs");
            foreach (var output in outputs) {
                bool tracking = output.Value == trackingInputName;
                Send(output.Key, Encode((byte)(tracking ? 63 : 0), 0, (byte)(tracking ? 0 : 63)));
            }
        }

        private static void Send(uint id, byte[] bytes) {
            IntPtr handle;
            Check(midiOutOpen(out handle, id, IntPtr.Zero, IntPtr.Zero, 0));
            IntPtr data = Marshal.AllocHGlobal(bytes.Length);
            uint size = (uint)Marshal.SizeOf(typeof(Header));
            IntPtr pointer = Marshal.AllocHGlobal((int)size);
            bool prepared = false;
            try {
                Marshal.Copy(bytes, 0, data, bytes.Length);
                var header = new Header { data = data, length = (uint)bytes.Length, extra = new UIntPtr[8] };
                Marshal.StructureToPtr(header, pointer, false);
                Check(midiOutPrepareHeader(handle, pointer, size)); prepared = true;
                Check(midiOutLongMsg(handle, pointer, size));
                bool completed = false;
                for (int i = 0; i < 200; i++) {
                    header = (Header)Marshal.PtrToStructure(pointer, typeof(Header));
                    if ((header.flags & 1) != 0) { completed = true; break; }
                    Thread.Sleep(5);
                }
                if (!completed) { midiOutReset(handle); throw new TimeoutException("Launchpad LED send timed out"); }
            } finally {
                if (prepared) {
                    uint result = midiOutUnprepareHeader(handle, pointer, size);
                    if (result != 0) { midiOutReset(handle); result = midiOutUnprepareHeader(handle, pointer, size); }
                    prepared = result != 0;
                }
                midiOutClose(handle);
                if (!prepared) { Marshal.FreeHGlobal(pointer); Marshal.FreeHGlobal(data); }
            }
        }
    }
}
