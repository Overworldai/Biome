; NSIS hooks for Biome uninstaller
; Cleans up portable data directories created next to the executable

!macro NSIS_HOOK_PREUNINSTALL
  ; Preserve user custom seeds on uninstall.
  ; If uploads/custom seeds directory exists, do not remove world_engine.
  IfFileExists "$INSTDIR\world_engine\seeds\uploads\*" preserve_world_engine
  RMDir /r "$INSTDIR\world_engine"
  Goto done_world_engine

preserve_world_engine:
  ; Remove bundled/default seeds and cache only. Keep uploads untouched.
  RMDir /r "$INSTDIR\world_engine\seeds\default"
  Delete "$INSTDIR\world_engine\.seeds_cache.bin"

done_world_engine:

  ; Remove .uv directory (UV package manager cache)
  RMDir /r "$INSTDIR\.uv"

  ; Do not touch custom_seeds on uninstall.
!macroend
