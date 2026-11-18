!macro customInstall
  SetShellVarContext current
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\resources\identity\register-identity.ps1"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Windows 通知包身份注册失败（错误码 $0）。详细信息请查看 %TEMP%\flowdesk-identity-install.log"
    Abort
  ${EndIf}
!macroend

!macro customUnInstall
  SetShellVarContext current
  nsExec::ExecToLog 'powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\resources\identity\unregister-identity.ps1"'
  Pop $0
!macroend
