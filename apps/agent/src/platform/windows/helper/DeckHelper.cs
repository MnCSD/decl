// Native Windows calls used by the agent's helper process (helper-host.ps1).
// Compiled once at helper startup with PowerShell's Add-Type.
// Only fixed operations live here; nothing takes commands or paths from the network.
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace DeskDeck
{
    // ---------------------------------------------------------------------
    // Core Audio (the same API the Windows volume mixer uses).
    // Interfaces are declared with only the methods we call, in vtable order;
    // methods we don't use still need a placeholder so the order stays right.
    // ---------------------------------------------------------------------

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out int count);
        int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
        int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
        int GetMasterVolumeLevel(out float levelDb);
        int GetMasterVolumeLevelScalar(out float level);
        int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
        int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
        int GetChannelVolumeLevel(uint channel, out float levelDb);
        int GetChannelVolumeLevelScalar(uint channel, out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumerator { }

    public static class Audio
    {
        const int eRender = 0;      // playback (speakers/headphones), not recording
        const int eMultimedia = 1;  // the device used for music/video
        const int CLSCTX_ALL = 23;

        // Looked up on every call, so switching the default output device just works.
        static IAudioEndpointVolume Endpoint()
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia, out device));
            var iid = typeof(IAudioEndpointVolume).GUID;
            object iface;
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out iface));
            return (IAudioEndpointVolume)iface;
        }

        /// <summary>Master volume 0–100, or -1 when there is no output device.</summary>
        public static int GetLevel()
        {
            try
            {
                float level;
                Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out level));
                return (int)Math.Round(level * 100);
            }
            catch (COMException) { return -1; }
        }

        public static bool GetMute()
        {
            bool mute;
            Marshal.ThrowExceptionForHR(Endpoint().GetMute(out mute));
            return mute;
        }

        public static void SetLevel(int percent)
        {
            var ctx = Guid.Empty;
            var ep = Endpoint();
            Marshal.ThrowExceptionForHR(ep.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, percent)) / 100f, ref ctx));
            if (percent > 0) Marshal.ThrowExceptionForHR(ep.SetMute(false, ref ctx)); // like turning the knob up
        }

        public static bool ToggleMute()
        {
            var ctx = Guid.Empty;
            var ep = Endpoint();
            bool mute;
            Marshal.ThrowExceptionForHR(ep.GetMute(out mute));
            Marshal.ThrowExceptionForHR(ep.SetMute(!mute, ref ctx));
            return !mute;
        }
    }

    // ---------------------------------------------------------------------
    // Keyboard, display, session.
    // ---------------------------------------------------------------------

    public static class Native
    {
        [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool LockWorkStation();
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        const uint KEYEVENTF_KEYUP = 0x2;
        public const byte VK_MEDIA_NEXT_TRACK = 0xB0;
        public const byte VK_MEDIA_PREV_TRACK = 0xB1;
        public const byte VK_MEDIA_PLAY_PAUSE = 0xB3;

        /// <summary>Presses and releases a key, as if typed on the keyboard (used for media keys).</summary>
        public static void TapKey(byte vk)
        {
            keybd_event(vk, 0, 0, UIntPtr.Zero);
            keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        /// <summary>
        /// Turns all monitors off (they wake on mouse/keyboard input).
        /// Broadcasts WM_SYSCOMMAND / SC_MONITORPOWER with 2 = "off". PostMessage (not
        /// SendMessage) so a hung window can't block us.
        /// </summary>
        public static void MonitorsOff()
        {
            PostMessage(new IntPtr(0xFFFF), 0x0112, new IntPtr(0xF170), new IntPtr(2));
        }

        public static void Lock()
        {
            if (!LockWorkStation()) throw new InvalidOperationException("LockWorkStation failed");
        }

        /// <summary>
        /// Without this, Windows reports a scaled-down screen size on high-DPI displays
        /// and screenshots come out blurry and cropped.
        /// </summary>
        public static void EnableDpiAwareness()
        {
            SetProcessDPIAware();
        }

        /// <summary>Saves a PNG of all monitors to `path`.</summary>
        public static void Screenshot(string path)
        {
            Rectangle bounds = SystemInformation.VirtualScreen; // all monitors together
            using (var bmp = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size);
                bmp.Save(path, ImageFormat.Png);
            }
        }

        // Wraps a WinRT IRandomAccessStream in a classic COM IStream. Windows PowerShell 5.1
        // can't cast WinRT streams to .NET types, but it can pass them here as plain objects.
        [DllImport("shcore.dll")]
        static extern int CreateStreamOverRandomAccessStream(
            [MarshalAs(UnmanagedType.IUnknown)] object randomAccessStream,
            ref Guid riid,
            out System.Runtime.InteropServices.ComTypes.IStream stream);

        /// <summary>Album art: reads a WinRT stream (SMTC thumbnail) and returns a small JPEG data URL.</summary>
        public static string ThumbnailFromWinRtStream(object randomAccessStream, int size, bool spotify)
        {
            var iidIStream = new Guid("0000000C-0000-0000-C000-000000000046");
            System.Runtime.InteropServices.ComTypes.IStream com;
            Marshal.ThrowExceptionForHR(CreateStreamOverRandomAccessStream(randomAccessStream, ref iidIStream, out com));

            var bytes = new System.IO.MemoryStream();
            var buffer = new byte[64 * 1024];
            IntPtr readPtr = Marshal.AllocHGlobal(sizeof(int));
            try
            {
                while (true)
                {
                    com.Read(buffer, buffer.Length, readPtr);
                    int read = Marshal.ReadInt32(readPtr);
                    if (read <= 0) break;
                    bytes.Write(buffer, 0, read);
                    if (bytes.Length > 8 * 1024 * 1024) break; // album art is never this big
                }
            }
            finally
            {
                Marshal.FreeHGlobal(readPtr);
            }
            bytes.Position = 0;
            return ThumbnailDataUrl(bytes, size, spotify);
        }

        /// <summary>Small JPEG data URL from an image stream (album art), so state messages stay small.</summary>
        public static string ThumbnailDataUrl(System.IO.Stream input, int size, bool spotify)
        {
            using (var src = new Bitmap(Image.FromStream(input)))
            using (var dst = new Bitmap(size, size))
            using (var g = Graphics.FromImage(dst))
            using (var ms = new System.IO.MemoryStream())
            {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                // Crop to a centered square (or just the art, for Spotify), then scale.
                int side = Math.Min(src.Width, src.Height);
                var crop = spotify
                    ? SpotifyArtBounds(src)
                    : new Rectangle((src.Width - side) / 2, (src.Height - side) / 2, side, side);
                g.DrawImage(src, new Rectangle(0, 0, size, size), crop, GraphicsUnit.Pixel);
                dst.Save(ms, ImageFormat.Jpeg);
                return "data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray());
            }
        }

        /// <summary>
        /// Spotify's media thumbnail is a black square with the album art at the top
        /// (about 78% wide, centered) and a "Spotify" logo bar below it. Find the art:
        /// the black side margins end where the art begins.
        /// </summary>
        static Rectangle SpotifyArtBounds(Bitmap src)
        {
            int w = src.Width, h = src.Height;
            int left = 0, right = w - 1;
            while (left < w / 3 && ColumnIsBlack(src, left, h / 2)) left++;
            while (right > w * 2 / 3 && ColumnIsBlack(src, right, h / 2)) right--;
            int side = right - left + 1;
            bool looksRight = side > w * 0.65 && side < w * 0.9 && Math.Abs(left - (w - 1 - right)) < w * 0.05;
            if (!looksRight)
            {
                // Very dark art can hide its edges; fall back to the usual layout.
                left = (int)(w * 0.11);
                side = (int)(w * 0.78);
            }
            int inset = Math.Max(1, side / 100); // trim the soft edge JPEG leaves around the art
            return new Rectangle(left + inset, inset, side - 2 * inset, side - 2 * inset);
        }

        static bool ColumnIsBlack(Bitmap bmp, int x, int rows)
        {
            for (int y = 0; y < rows; y += 2)
            {
                var p = bmp.GetPixel(x, y);
                if (Math.Max(p.R, Math.Max(p.G, p.B)) > 24) return false;
            }
            return true;
        }

        public static void Sleep()
        {
            // Suspend = sleep (S3/modern standby), not hibernate. force=false lets apps finish up.
            Application.SetSuspendState(PowerState.Suspend, false, false);
        }
    }
}
