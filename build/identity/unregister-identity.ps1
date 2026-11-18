$ErrorActionPreference = 'SilentlyContinue'

Stop-Process -Name 'NotificationBridge', 'SmartDeskBox.DesktopApp' -Force -ErrorAction SilentlyContinue

try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class FlowDeskDesktopRestore {
  [DllImport("user32.dll")]
  private static extern bool EnumWindows(Func<IntPtr, IntPtr, bool> cb, IntPtr p);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string n);

  [DllImport("user32.dll")]
  private static extern bool ShowWindow(IntPtr h, int c);

  public static void Restore() {
    EnumWindows((w, _) => {
      var v = FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null);
      if (v != IntPtr.Zero) {
        var l = FindWindowEx(v, IntPtr.Zero, "SysListView32", null);
        if (l != IntPtr.Zero) {
          ShowWindow(l, 5);
        }
        return false;
      }
      return true;
    }, IntPtr.Zero);
  }
}
'@ -ErrorAction SilentlyContinue

  [FlowDeskDesktopRestore]::Restore()
} catch {
  # 卸载时桌面图标恢复失败不阻断卸载流程
}

Get-AppxPackage -Name 'WindowsDynamicIsland' -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
