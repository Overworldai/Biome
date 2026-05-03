"""
Parser for Gemma 4 tool calls.

Gemma 4 emits tool calls in the format:

    <|tool_call>call:function_name{arg_name:<|"|>value<|"|>, ...}<tool_call|>

Empty-arg calls render as `<|tool_call>call:function_name{}<tool_call|>`.
String values are wrapped in the `<|"|>` special token. Reasoning produced
by the model lands in a separate `<|channel>thought...<channel|>` block
before the tool call and is ignored by this parser.
"""

import re
from dataclasses import dataclass, field


@dataclass
class ToolCall:
    name: str
    arguments: dict[str, str] = field(default_factory=dict)


_TOOL_CALL_RE = re.compile(r"<\|tool_call>call:(\w+)\{(.*?)\}<tool_call\|>", re.DOTALL)
_ARG_RE = re.compile(r'(\w+)\s*:\s*<\|"\|>(.*?)<\|"\|>', re.DOTALL)


def parse_tool_calls(text: str) -> list[ToolCall]:
    """Parse all tool calls from model output. Raises ValueError if none found."""
    results = []
    for m in _TOOL_CALL_RE.finditer(text):
        name = m.group(1)
        args = {am.group(1): am.group(2) for am in _ARG_RE.finditer(m.group(2))}
        results.append(ToolCall(name=name, arguments=args))

    if not results:
        raise ValueError(f"No valid tool calls found in output: {text!r}")

    return results
