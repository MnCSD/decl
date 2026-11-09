import { runPowerShell } from './exec';

/**
 * Extracts app icons exactly as Windows draws them (same source as Explorer),
 * as PNG data URLs.
 *
 * How: a small C# snippet (compiled on the fly by PowerShell's Add-Type) calls the
 * Shell API IShellItemImageFactory.GetImage, which returns a 32-bit bitmap with
 * transparency. GDI+ drops the alpha channel when converting HBITMAPs, so we
 * re-wrap the same pixel memory as premultiplied ARGB before saving as PNG.
 *
 * Input/output go through environment variables / stdout JSON, never by
 * pasting paths into the script text.
 */
const ICON_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class DeckIcons {
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; }

  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc,
    [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);

  const int SIIGBF_BIGGERSIZEOK = 0x1, SIIGBF_ICONONLY = 0x4;

  public static string PngBase64(string path, int size) {
    IShellItemImageFactory factory;
    SHCreateItemFromParsingName(path, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out factory);
    IntPtr hbm;
    int hr = factory.GetImage(new SIZE { cx = size, cy = size }, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK, out hbm);
    if (hr != 0) throw new Exception("GetImage failed: 0x" + hr.ToString("X8"));
    try {
      using (Bitmap raw = Image.FromHbitmap(hbm)) {
        Rectangle rect = new Rectangle(0, 0, raw.Width, raw.Height);
        BitmapData data = raw.LockBits(rect, ImageLockMode.ReadOnly, raw.PixelFormat);
        try {
          using (Bitmap withAlpha = new Bitmap(data.Width, data.Height, data.Stride, PixelFormat.Format32bppPArgb, data.Scan0))
          using (MemoryStream ms = new MemoryStream()) {
            withAlpha.Save(ms, ImageFormat.Png);
            return Convert.ToBase64String(ms.ToArray());
          }
        } finally { raw.UnlockBits(data); }
      }
    } finally { DeleteObject(hbm); }
  }
}
"@

$items = $env:DECK_ICON_REQUEST | ConvertFrom-Json
$out = @{}
foreach ($item in $items) {
  try { $out[$item.id] = [DeckIcons]::PngBase64($item.path, [int]$env:DECK_ICON_SIZE) }
  catch { [Console]::Error.WriteLine("icon failed for $($item.id): $($_.Exception.Message)") }
}
$out | ConvertTo-Json -Compress
`;

export interface IconRequest {
  id: string;
  /** exe/ico/lnk file to take the icon from */
  path: string;
}

/** Returns { appId: "data:image/png;base64,..." } for every icon that could be extracted. */
export async function extractIcons(requests: IconRequest[], size = 128): Promise<Record<string, string>> {
  if (requests.length === 0) return {};
  const stdout = await runPowerShell(ICON_SCRIPT, 30_000, {
    DECK_ICON_REQUEST: JSON.stringify(requests),
    DECK_ICON_SIZE: String(size),
  });
  const parsed = JSON.parse(stdout.trim() || '{}') as Record<string, string>;
  const icons: Record<string, string> = {};
  for (const [id, base64] of Object.entries(parsed)) {
    if (typeof base64 === 'string' && base64.length > 0) icons[id] = `data:image/png;base64,${base64}`;
  }
  return icons;
}
