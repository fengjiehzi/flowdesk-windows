!macro customInstall
  SetShellVarContext current
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-AppxPackage -Name WindowsDynamicIsland | Remove-AppxPackage -ErrorAction SilentlyContinue; Add-AppxPackage -Path $\"$INSTDIR\resources\identity\WindowsDynamicIsland.Identity.msix$\" -ExternalLocation $\"$INSTDIR$\""'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Windows 通知包身份注册失败（错误码 $0）。"
    Abort
  ${EndIf}
!macroend

!macro customUnInstall
  SetShellVarContext current
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-AppxPackage -Name WindowsDynamicIsland | Remove-AppxPackage -ErrorAction SilentlyContinue"'
!macroend
