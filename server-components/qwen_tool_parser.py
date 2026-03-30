"""
Parser for Qwen3-style XML tool calls.

Extracts structured tool calls from model output in the format:

    <tool_call>
    <function=function_name>
    <parameter=param1>value1</parameter>
    <parameter=param2>value2</parameter>
    </function>
    </tool_call>

Tolerates truncated output (missing closing tags) which can occur when
the model hits the max_new_tokens limit.
"""

import re
from dataclasses import dataclass, field


@dataclass
class ToolCall:
    """A parsed tool call with function name and string parameters."""

    name: str
    arguments: dict[str, str] = field(default_factory=dict)


# Matches a <tool_call> block, with or without a closing </tool_call> tag
_TOOL_CALL_RE = re.compile(r"<tool_call>(.*?)(?:</tool_call>|$)", re.DOTALL)
# Matches <function=name> or <function name="name">
_FUNCTION_RE = re.compile(r'<function(?:=|\s+name=")([^">]+)"?>')
# Matches <parameter=name>value</parameter>
_PARAMETER_RE = re.compile(r"<parameter=([^>]+)>(.*?)</parameter>", re.DOTALL)
# Matches a truncated final parameter: <parameter=name>value (no closing tag)
_TRUNCATED_PARAM_RE = re.compile(r"<parameter=([^>]+)>([^<]+)$", re.DOTALL)


def parse_tool_calls(text: str) -> list[ToolCall]:
    """Parse all tool calls from model output text.

    Handles truncated output where closing tags may be missing due to
    token limits.

    Returns a list of ToolCall objects. Raises ValueError if no valid
    tool calls are found.
    """
    results = []

    for block_match in _TOOL_CALL_RE.finditer(text):
        block = block_match.group(1)

        func_match = _FUNCTION_RE.search(block)
        if not func_match:
            continue

        name = func_match.group(1).strip()
        arguments = {}

        for param_match in _PARAMETER_RE.finditer(block):
            param_name = param_match.group(1).strip()
            param_value = param_match.group(2).strip()
            arguments[param_name] = param_value

        # Check for a truncated final parameter (no closing </parameter>)
        if not arguments or block.rstrip().endswith("</parameter>") is False:
            trunc_match = _TRUNCATED_PARAM_RE.search(block)
            if trunc_match:
                param_name = trunc_match.group(1).strip()
                param_value = trunc_match.group(2).strip()
                if param_name not in arguments and param_value:
                    arguments[param_name] = param_value

        results.append(ToolCall(name=name, arguments=arguments))

    if not results:
        raise ValueError(f"No valid tool calls found in output: {text!r}")

    return results
