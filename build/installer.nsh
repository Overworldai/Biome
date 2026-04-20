# Override the directory page's top text to warn about Program Files.
# This is prepended before MUI2 is included, so the define is picked up when MUI_PAGE_DIRECTORY runs.
!define MUI_DIRECTORYPAGE_TEXT_TOP "Setup will install $(^NameDA) in the following folder.$\r$\n$\r$\nTo install in a different folder, click Browse and select another folder.$\r$\n$\r$\nNote: Biome cannot be installed under Program Files - Windows prevents applications from writing files to their own installation directory within Program Files. If the button is greyed out, try another directory."

Function .onVerifyInstDir
  # Reject installs under Program Files — the app writes to $INSTDIR at runtime
  # (uv, world_engine/, HF cache) and those paths require admin rights to write.
  StrLen $R0 "$PROGRAMFILES"
  StrCpy $R1 "$INSTDIR" $R0
  StrCmp $R1 "$PROGRAMFILES" 0 +2
    Abort

  StrLen $R0 "$PROGRAMFILES64"
  StrCpy $R1 "$INSTDIR" $R0
  StrCmp $R1 "$PROGRAMFILES64" 0 +2
    Abort
FunctionEnd

!macro customRemoveFiles
  StrCpy $R1 "$PLUGINSDIR\biome-hf-cache-backup"

  ${if} ${isUpdated}
    DetailPrint "Upgrade detected: preserving Hugging Face cache."

    RMDir /r "$R1"

    IfFileExists "$INSTDIR\world_engine\.cache\huggingface\hub\*" 0 +2
      Rename "$INSTDIR\world_engine\.cache\huggingface\hub" "$R1"

    # Keep standard upgrade behavior: remove previous install before reinstalling.
    RMDir /r "$INSTDIR"

    IfFileExists "$R1\*" 0 +4
      CreateDirectory "$INSTDIR\world_engine\.cache"
      CreateDirectory "$INSTDIR\world_engine\.cache\huggingface"
      Rename "$R1" "$INSTDIR\world_engine\.cache\huggingface\hub"
  ${else}
    # Remove installed files, including model/cache directories.
    RMDir /r "$INSTDIR"
  ${endif}
!macroend
