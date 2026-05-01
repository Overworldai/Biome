"""
Keycap-to-engine button-code mapping.

The renderer sends `ControlNotif.buttons` as keycap strings (e.g. "W",
"MOUSE_LEFT"); the receiver looks each up in `BUTTON_CODES` to get the
int codes the world engine consumes. The numeric codes mirror Windows
virtual-key codes for the alphanumeric and modifier keys; mouse buttons
use the standard 0x01 / 0x02 / 0x04 layout.

This is configuration / lookup data — kept in its own module so the
engine (`engine/manager.py`) and WebSocket dispatch (`server/session/`)
can both reference it without `engine.manager` owning unrelated input
constants.
"""

def _build_button_codes() -> dict[str, int]:
    codes: dict[str, int] = {}
    # A-Z keys
    for i in range(65, 91):
        codes[chr(i)] = i
    # 0-9 keys
    for i in range(10):
        codes[str(i)] = ord(str(i))
    # Special keys
    codes["UP"] = 0x26
    codes["DOWN"] = 0x28
    codes["LEFT"] = 0x25
    codes["RIGHT"] = 0x27
    codes["SHIFT"] = 0x10
    codes["CTRL"] = 0x11
    codes["SPACE"] = 0x20
    codes["TAB"] = 0x09
    codes["ENTER"] = 0x0D
    codes["MOUSE_LEFT"] = 0x01
    codes["MOUSE_RIGHT"] = 0x02
    codes["MOUSE_MIDDLE"] = 0x04
    return codes


BUTTON_CODES: dict[str, int] = _build_button_codes()
