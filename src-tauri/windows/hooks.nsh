; NSIS hooks for Biome uninstaller
; Cleans up portable data directories created next to the executable

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove world_engine entirely when there are no user-uploaded seeds.
  IfFileExists "$INSTDIR\world_engine\seeds\uploads\*" preserve_uploads
  RMDir /r "$INSTDIR\world_engine"
  Goto done_world_engine

preserve_uploads:
  ; Keep user uploads only, clear everything else in world_engine.
  RMDir /r "$INSTDIR\_biome_keep_uploads"
  Rename "$INSTDIR\world_engine\seeds\uploads" "$INSTDIR\_biome_keep_uploads"
  RMDir /r "$INSTDIR\world_engine"
  CreateDirectory "$INSTDIR\world_engine\seeds"
  Rename "$INSTDIR\_biome_keep_uploads" "$INSTDIR\world_engine\seeds\uploads"

done_world_engine:

  ; Remove .uv directory (UV package manager cache)
  RMDir /r "$INSTDIR\.uv"

  ; Preserve world_engine\seeds\uploads on uninstall.
!macroend
