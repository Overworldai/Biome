; NSIS hooks for Biome uninstaller
; Cleans up portable data directories created next to the executable

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove world_engine directory
  RMDir /r "$INSTDIR\world_engine"

  ; Remove .uv directory (UV package manager cache)
  RMDir /r "$INSTDIR\.uv"

  ; Remove custom_seeds only if empty (preserves user seeds)
  RMDir "$INSTDIR\custom_seeds"
!macroend
