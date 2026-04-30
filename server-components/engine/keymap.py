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

BUTTON_CODES: dict[str, int] = {}
# A-Z keys
for _i in range(65, 91):
    BUTTON_CODES[chr(_i)] = _i
# 0-9 keys
for _i in range(10):
    BUTTON_CODES[str(_i)] = ord(str(_i))
del _i
# Special keys
BUTTON_CODES["UP"] = 0x26
BUTTON_CODES["DOWN"] = 0x28
BUTTON_CODES["LEFT"] = 0x25
BUTTON_CODES["RIGHT"] = 0x27
BUTTON_CODES["SHIFT"] = 0x10
BUTTON_CODES["CTRL"] = 0x11
BUTTON_CODES["SPACE"] = 0x20
BUTTON_CODES["TAB"] = 0x09
BUTTON_CODES["ENTER"] = 0x0D
BUTTON_CODES["MOUSE_LEFT"] = 0x01
BUTTON_CODES["MOUSE_RIGHT"] = 0x02
BUTTON_CODES["MOUSE_MIDDLE"] = 0x04
