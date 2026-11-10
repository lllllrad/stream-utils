using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace StreamUtils {
    // MIDI belongs to the API process, never to the Warudo integration.
    public sealed class MidiInput : IDisposable {
        public sealed class Device {
            public uint id;
            public string name;
            public string deviceInterface;
        }
        public struct Message { public int status, data1, data2; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct Caps {
            public ushort manufacturer, product;
            public uint version;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string name;
            public uint support;
        }
        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate void Callback(IntPtr handle, uint message, UIntPtr instance, UIntPtr param1, UIntPtr param2);
        [DllImport("winmm.dll")] private static extern uint midiInGetNumDevs();
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)] private static extern uint midiInGetDevCapsW(UIntPtr id, out Caps caps, uint size);
        [DllImport("winmm.dll")] private static extern uint midiInMessage(IntPtr id, uint message, IntPtr param1, UIntPtr param2);
        [DllImport("winmm.dll")] private static extern uint midiInOpen(out IntPtr handle, uint id, Callback callback, UIntPtr instance, uint flags);
        [DllImport("winmm.dll")] private static extern uint midiInStart(IntPtr handle);
        [DllImport("winmm.dll")] private static extern uint midiInStop(IntPtr handle);
        [DllImport("winmm.dll")] private static extern uint midiInReset(IntPtr handle);
        [DllImport("winmm.dll")] private static extern uint midiInClose(IntPtr handle);
        private readonly ConcurrentQueue<Message> queue = new ConcurrentQueue<Message>();
        private readonly Callback callback;
        private IntPtr handle;
        private static void Check(uint code) { if (code != 0) throw new InvalidOperationException("WinMM MIDI error " + code); }

        private static string Interface(uint id) {
            IntPtr size = Marshal.AllocHGlobal(4);
            try {
                Marshal.WriteInt32(size, 0);
                if (midiInMessage(new IntPtr(id), 0x080c, size, UIntPtr.Zero) != 0) return "";
                int bytes = Marshal.ReadInt32(size);
                if (bytes < 2 || bytes > 65536) return "";
                IntPtr buffer = Marshal.AllocHGlobal(bytes);
                try {
                    if (midiInMessage(new IntPtr(id), 0x080d, buffer, new UIntPtr((uint)bytes)) != 0) return "";
                    return Marshal.PtrToStringUni(buffer) ?? "";
                } finally { Marshal.FreeHGlobal(buffer); }
            } finally { Marshal.FreeHGlobal(size); }
        }
        public static Device[] Devices() {
            uint count = midiInGetNumDevs();
            var result = new List<Device>();
            for (uint i = 0; i < count; i++) {
                Caps caps;
                Check(midiInGetDevCapsW(new UIntPtr(i), out caps, (uint)Marshal.SizeOf(typeof(Caps))));
                result.Add(new Device { id = i, name = caps.name, deviceInterface = Interface(i) });
            }
            return result.ToArray();
        }
        public MidiInput(uint id) {
            callback = Receive;
            Check(midiInOpen(out handle, id, callback, UIntPtr.Zero, 0x30020));
            try { Check(midiInStart(handle)); } catch { Dispose(); throw; }
        }
        private void Receive(IntPtr device, uint message, UIntPtr instance, UIntPtr param1, UIntPtr timestamp) {
            // Keep the native callback short; never call WinMM or write stdout here.
            if (message == 0x3c3) {
                uint packed = param1.ToUInt32();
                queue.Enqueue(new Message { status = (int)(packed & 255), data1 = (int)((packed >> 8) & 127), data2 = (int)((packed >> 16) & 127) });
            } else if (message == 0x3c5 || message == 0x3cc) {
                // Dropped / corrupt input could lose the release message. Fail closed.
                queue.Enqueue(new Message());
            }
        }
        public Message[] Drain() {
            var messages = new List<Message>();
            Message value;
            while (queue.TryDequeue(out value)) messages.Add(value);
            return messages.ToArray();
        }
        public void Dispose() {
            if (handle == IntPtr.Zero) return;
            midiInStop(handle); midiInReset(handle); midiInClose(handle);
            handle = IntPtr.Zero;
            GC.KeepAlive(callback);
        }
    }
}
