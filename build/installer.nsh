!macro customInstall
  SetShellVarContext current
  System::Call 'Kernel32::SetEnvironmentVariable(t "FLOWDESK_INSTDIR", t "$INSTDIR")'
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$$ErrorActionPreference = '\''Stop'\''; $$dir = $$env:FLOWDESK_INSTDIR; Get-AppxPackage -Name WindowsDynamicIsland | Remove-AppxPackage -ErrorAction SilentlyContinue; Add-AppxPackage -Path (Join-Path $$dir '\''resources\identity\WindowsDynamicIsland.Identity.msix'\'') -ExternalLocation $$dir"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Windows 通知包身份注册失败（错误码 $0）。"
    Abort
  ${EndIf}
!macroend

!macro customUnInstall
  SetShellVarContext current
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Stop-Process -Name '\''NotificationBridge'\'','\''SmartDeskBox.DesktopApp'\'' -Force -ErrorAction SilentlyContinue; Add-Type -TypeDefinition '\''using System;using System.Runtime.InteropServices;public static class FD{ [DllImport(\"user32.dll\")] public static extern bool EnumWindows(Func<IntPtr,IntPtr,bool> cb, IntPtr p); [DllImport(\"user32.dll\",CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string n); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int c); public static void Restore(){ EnumWindows((w,_)=>{ var v=FindWindowEx(w,IntPtr.Zero,\"SHELLDLL_DefView\",null); if(v!=IntPtr.Zero){ var l=FindWindowEx(v,IntPtr.Zero,\"SysListView32\",null); if(l!=IntPtr.Zero) ShowWindow(l,5); return false; } return true; },IntPtr.Zero); } }'\'' -ErrorAction SilentlyContinue; [FD]::Restore(); Get-AppxPackage -Name WindowsDynamicIsland | Remove-AppxPackage -ErrorAction SilentlyContinue"'
  Pop $0
!macroend
