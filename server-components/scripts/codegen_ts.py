"""
Hand-rolled Pydantic → TypeScript codegen.

Walks `server.protocol`'s module surface and emits one TypeScript file
mirroring every `StrEnum` (as a string-literal union), every `BaseModel`
(as an `interface`), and every `Annotated[Union[...], Field(discriminator=...)]`
type alias (as a TS discriminated union).

Pydantic's wire format on this codebase uses `model_dump_json(exclude_none=True)`,
so a field typed `T | None` with default `None` is *absent* on the wire when
unset — not `null`. The codegen renders those as `field?: T` (optional, no
nullable). Required-but-nullable (`T | None` with no default) gets `field: T | null`,
though we don't currently have any such fields.

Run with:

    uv run python scripts/codegen_ts.py

Output goes to `../src/types/protocol.generated.ts` (relative to this script).
Pass `--check` to fail with a non-zero exit if the on-disk file would change —
useful as a CI freshness gate.
"""

from __future__ import annotations

import argparse
import inspect
import re
import sys
import types
import typing
from enum import StrEnum
from pathlib import Path
from types import ModuleType
from typing import TYPE_CHECKING, Annotated, Any, Literal, Union, get_args, get_origin

from pydantic import BaseModel
from pydantic_core import PydanticUndefined

if TYPE_CHECKING:
    from pydantic.fields import FieldInfo

# Keep imports here so the script runs from `server-components/`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from recording import video_recorder
from server import protocol

# Modules whose `BaseModel` / `StrEnum` declarations get generated alongside
# `protocol.py`'s. Each module's classes are scanned independently and the
# combined output is emitted as one TS file. Add a module here when a new
# typed shape needs to cross the Python ↔ TS boundary.
EXTRA_MODULES: list[ModuleType] = [video_recorder]

DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent.parent / "src" / "types" / "protocol.generated.ts"

HEADER = """\
// THIS FILE IS GENERATED. DO NOT EDIT BY HAND.
//
// Source:    server-components/server/protocol.py + recording/video_recorder.py
// Regenerate: cd server-components && uv run python scripts/codegen_ts.py
//
// Each item ships as a Zod schema (the runtime validator) plus a
// `z.infer<typeof ...Schema>` type alias derived from it. Schemas are
// the source of truth — drift between schema and type is structurally
// impossible. CI runs the codegen with `--check` and fails if this
// file is stale relative to its sources.
"""


# ─── Type translation ────────────────────────────────────────────────


def render_type(tp: Any) -> str:
    """Render a Python type annotation as a TypeScript type expression.

    Optionality (`T | None` with default `None`) is handled at the field
    level, not here — this function only renders the inner type for the
    type position. Use `render_field_type` to get the field-position rendering.
    """
    # Strip Annotated[...] wrappers
    while get_origin(tp) is Annotated:
        tp = get_args(tp)[0]

    # TypeVar (e.g. the `T` in RpcSuccess[T])
    if isinstance(tp, typing.TypeVar):
        return tp.__name__

    origin = get_origin(tp)

    # Union types: T | U | None  →  T | U | null  (with null only if None present).
    # Dedup is by *rendered* TS form so `int | float` collapses to a single
    # `number` rather than `number | number`.
    if origin in (Union, types.UnionType):
        args = list(get_args(tp))
        has_none = type(None) in args
        non_none = [a for a in args if a is not type(None)]
        rendered_unique: list[str] = []
        for a in non_none:
            r = render_type(a)
            if r not in rendered_unique:
                rendered_unique.append(r)
        rendered = " | ".join(rendered_unique)
        if has_none:
            rendered += " | null"
        return rendered

    # Literal["x", "y"]  →  'x' | 'y'
    if origin is Literal:
        return " | ".join(render_literal(a) for a in get_args(tp))

    # list[T]  →  T[]
    if origin is list:
        (inner,) = get_args(tp)
        return f"{render_type(inner)}[]"

    # dict[K, V]  →  Record<K, V>
    if origin is dict:
        k, v = get_args(tp)
        return f"Record<{render_type(k)}, {render_type(v)}>"

    # Generic instance: RpcSuccess[FooData]  →  RpcSuccess<FooData>
    if origin is not None and inspect.isclass(origin) and issubclass(origin, BaseModel):
        type_args = get_args(tp)
        return f"{ts_name(origin.__name__)}<{', '.join(render_type(a) for a in type_args)}>"

    # Primitive scalars
    if tp is str:
        return "string"
    if tp is bool:
        return "boolean"
    if tp is int or tp is float:
        return "number"
    if tp is bytes:
        return "string"  # base64-encoded by convention here
    if tp is type(None):
        return "null"

    # Class references
    if inspect.isclass(tp):
        if issubclass(tp, StrEnum):
            return ts_name(tp.__name__)
        if issubclass(tp, BaseModel):
            return ts_name(tp.__name__)

    raise NotImplementedError(f"Cannot render Python type to TS: {tp!r}")


def render_literal(value: Any) -> str:
    """Render a Literal[...] member as a TS literal."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        # Use double quotes to keep the file Prettier-clean (single quotes
        # would also work but the project's TS uses single quotes; Prettier
        # will normalise either way).
        return f"'{value}'"
    if isinstance(value, int):
        return str(value)
    raise NotImplementedError(f"Cannot render literal: {value!r}")


# ─── Field optionality ───────────────────────────────────────────────


def is_wire_optional(field_info: FieldInfo) -> bool:
    """A field is wire-optional (renders as `field?: T`) when the consumer
    can leave it off:

      1. `T | None` with default `None` — Pydantic's `exclude_none=True`
         drops it from the wire when unset.
      2. Any non-Literal field with a default value — Pydantic accepts the
         field as missing on input (server fills in the default) and emits
         it on output. We render this as wire-optional because send-side
         consumers can omit it; receive-side consumers see it populated.

    Literal-typed fields are excluded so discriminator fields like
    `type: Literal["status"] = "status"` stay required — the default is
    just sugar for "always emit this value".
    """
    annotation = field_info.annotation
    if get_origin(annotation) is Literal:
        return False
    return field_info.default is not PydanticUndefined or field_info.default_factory is not None


def strip_none_from_annotation(annotation: Any) -> Any:
    """Strip `None` from a `T | None` annotation so the rendered field type
    is just `T`. Used when the field is wire-optional (None is encoded as
    absence, not as null)."""
    origin = get_origin(annotation)
    if origin in (Union, types.UnionType):
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            return args[0]
        return Union[tuple(args)]  # noqa: UP007  -- can't spread a tuple into `A | B | C` syntax
    return annotation


# ─── Renderers ───────────────────────────────────────────────────────


def render_docstring(obj: Any) -> list[str]:
    """Render a docstring as a JSDoc block. Only uses a class's *own*
    docstring (not inherited) — `inspect.getdoc` walks the MRO and would
    pull Pydantic BaseModel / StrEnum docstrings into every subclass."""
    raw = obj.__dict__.get("__doc__") if inspect.isclass(obj) else inspect.getdoc(obj)
    if not raw:
        return []
    raw = inspect.cleandoc(raw)
    if "\n" in raw:
        return ["/**", *(f" * {line}".rstrip() for line in raw.splitlines()), " */"]
    return [f"/** {raw} */"]


def render_enum(enum_cls: type[StrEnum]) -> str:
    """Emit the Zod schema and a `z.infer`-derived type alias. Output
    is shaped to match what Prettier would produce against the project's
    config (single quotes, `trailingComma: "none"`, 120-char width):
    short enums collapse onto one line; long ones break across lines
    with two-space indent. Mirroring the layout means `codegen --check`
    and `prettier --check` agree on the on-disk file."""
    name = ts_name(enum_cls.__name__)
    members = list(enum_cls)
    inline_members = ", ".join(render_literal(m.value) for m in members)
    inline = f"export const {name}Schema = z.enum([{inline_members}])"
    out: list[str] = list(render_docstring(enum_cls))
    if len(inline) <= _PRINT_WIDTH:
        out.append(inline)
    else:
        out.append(f"export const {name}Schema = z.enum([")
        for i, m in enumerate(members):
            terminator = "" if i == len(members) - 1 else ","
            out.append(f"  {render_literal(m.value)}{terminator}")
        out.append("])")
    out.append(f"export type {name} = z.infer<typeof {name}Schema>")
    return "\n".join(out)


def render_model(model_cls: type[BaseModel]) -> str:
    """Emit the Zod schema and the matching type. Non-generic models get a
    `z.infer<typeof ...Schema>` alias (drift is structurally impossible).
    Generic models keep a hand-typed `interface` because Zod can't carry
    the type parameter through `z.infer` — the schema validates the
    runtime envelope with `data: z.unknown()` and the interface lets the
    consumer bind `T` at the call site."""
    name = ts_name(model_cls.__name__)
    type_params = getattr(model_cls, "__type_params__", ())
    fields = list(model_cls.model_fields.items())

    out: list[str] = list(render_docstring(model_cls))

    # Schema (always; for generics this uses z.unknown() for type-param fields)
    out.append(f"export const {name}Schema = z.object({{")
    for i, (field_name, field_info) in enumerate(fields):
        ann = field_info.annotation
        if is_wire_optional(field_info):
            # Strip `| None` for the `T | None = None` shape so the
            # schema is `<T>.optional()` rather than `<T>.nullable().optional()`.
            if field_info.default is None and type(None) in get_args(ann):
                ann = strip_none_from_annotation(ann)
            rendered = f"{render_zod_type(ann)}.optional()"
        else:
            rendered = render_zod_type(ann)
        terminator = "" if i == len(fields) - 1 else ","
        out.append(f"  {field_name}: {rendered}{terminator}")
    out.append("})")

    # Type
    if type_params:
        param_names = [tp.__name__ for tp in type_params]
        out.append(f"export interface {name}<{', '.join(param_names)}> {{")
        for field_name, field_info in fields:
            ann = field_info.annotation
            if is_wire_optional(field_info):
                if field_info.default is None and type(None) in get_args(ann):
                    ann = strip_none_from_annotation(ann)
                out.append(f"  {field_name}?: {render_type(ann)}")
            else:
                out.append(f"  {field_name}: {render_type(field_info.annotation)}")
        out.append("}")
    else:
        out.append(f"export type {name} = z.infer<typeof {name}Schema>")
    return "\n".join(out)


PRETTIER_LINE_WIDTH = 120

# Python-side names that get a different name on the TS side. Each entry
# is justified by a comment — keep this list short.
_TS_RENAMES: dict[str, str] = {
    # `StageId` on the Python side covers only the stages the server
    # itself emits; the renderer combines it with installer-only stages
    # under its own `StageId` alias, so we ship the Python set as
    # `ServerStageId` to leave the broader name available.
    "StageId": "ServerStageId",
    # `RpcError` and `RpcSuccess` are the wire envelopes; the renderer
    # already has a JS `Error` subclass named `RpcError` in `wsRpc.ts`
    # so we ship the wire types under `*Response` names to avoid the
    # collision.
    "RpcError": "RpcErrorResponse",
    "RpcSuccess": "RpcSuccessResponse",
}


def ts_name(python_name: str) -> str:
    return _TS_RENAMES.get(python_name, python_name)


def render_union_alias(name: str, members: list[type[BaseModel]]) -> str:
    """Emit a `z.discriminatedUnion('type', [...])` schema and the
    matching `z.infer` type alias. All members must carry a
    `type: Literal["..."]` discriminator; the codegen guarantees this
    for every union it picks up."""
    member_schemas = [f"{ts_name(m.__name__)}Schema" for m in members]
    inline = f"z.discriminatedUnion('type', [{', '.join(member_schemas)}])"
    inline_wrapper = f"export const {ts_name(name)}Schema = {inline}"

    if len(inline_wrapper) <= PRETTIER_LINE_WIDTH:
        out = [inline_wrapper]
    else:
        out = [f"export const {ts_name(name)}Schema = z.discriminatedUnion('type', ["]
        for i, schema in enumerate(member_schemas):
            terminator = "" if i == len(member_schemas) - 1 else ","
            out.append(f"  {schema}{terminator}")
        out.append("])")

    out.append(f"export type {ts_name(name)} = z.infer<typeof {ts_name(name)}Schema>")
    return "\n".join(out)


# ─── Module walker ───────────────────────────────────────────────────


_CONST_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")

# Mirrors `printWidth` in `.prettierrc`. Used by `render_enum` to decide
# when to inline `z.enum([...])` vs. break it across lines so the codegen
# output round-trips through `prettier --check`.
_PRINT_WIDTH = 120


def collect_module_decls(
    module: ModuleType,
    *,
    collect_constants: bool,
) -> tuple[
    list[type[StrEnum]],
    list[type[BaseModel]],
    list[tuple[str, list[type[BaseModel]]]],
    list[tuple[str, int | float | str | bool]],
]:
    """Walk a module; return (enums, models, union_aliases, constants)
    preserving declaration order. Skips re-exports from other modules and
    private names. `constants` (when `collect_constants=True`) are
    module-level UPPER_SNAKE_CASE primitives (int / float / str / bool),
    emitted as `export const NAME = value`. Only the primary `protocol`
    module is scanned for constants — extra modules contribute models but
    not their internal implementation constants (e.g. local file paths)."""
    enums: list[type[StrEnum]] = []
    models: list[type[BaseModel]] = []
    union_aliases: list[tuple[str, list[type[BaseModel]]]] = []
    constants: list[tuple[str, int | float | str | bool]] = []

    module_vars: dict[str, Any] = vars(module)
    for name, obj in module_vars.items():
        if name.startswith("_"):
            continue

        # Class defined in this module?
        if inspect.isclass(obj) and obj.__module__ == module.__name__:
            if issubclass(obj, StrEnum):
                enums.append(obj)
                continue
            if issubclass(obj, BaseModel):
                models.append(obj)
                continue

        # Annotated[Union[...], Field(discriminator=...)] — module-level alias.
        # `Annotated` shows up as a special form, not a class.
        if get_origin(obj) is Annotated:
            inner = get_args(obj)[0]
            inner_origin = get_origin(inner)
            if inner_origin in (Union, types.UnionType):
                members = [a for a in get_args(inner) if inspect.isclass(a) and issubclass(a, BaseModel)]
                if members:
                    union_aliases.append((name, members))
                    continue

        # Module-level UPPER_SNAKE_CASE primitive — exported as a TS const.
        # `bool` is a subclass of `int` in Python; check it first so `True`
        # / `False` render as `true` / `false`, not `1` / `0`.
        if collect_constants and _CONST_NAME_RE.match(name) and isinstance(obj, bool | int | float | str):
            constants.append((name, obj))

    return enums, models, union_aliases, constants


def collect_rpc_pairs(models: list[type[BaseModel]]) -> list[tuple[str, type[BaseModel], type[BaseModel]]]:
    """Detect `*Request` ↔ `*ResponseData` pairs by name. Returns
    `(discriminator, request_cls, response_cls)` triples — used to emit
    a typed `RpcRequestMap` so callers of `WsRpcClient.request` can
    only pass a known type literal and get the matching response back.

    The discriminator string is read from the request's `type:
    Literal["..."]` field. Both halves must live in the same module."""
    by_name = {m.__name__: m for m in models}
    pairs: list[tuple[str, type[BaseModel], type[BaseModel]]] = []
    for request_cls in models:
        if not request_cls.__name__.endswith("Request"):
            continue
        response_name = request_cls.__name__.removesuffix("Request") + "ResponseData"
        response_cls = by_name.get(response_name)
        if response_cls is None:
            continue

        type_field = request_cls.model_fields.get("type")
        if type_field is None or get_origin(type_field.annotation) is not Literal:
            continue
        literal_args = get_args(type_field.annotation)
        if len(literal_args) != 1 or not isinstance(literal_args[0], str):
            continue
        pairs.append((literal_args[0], request_cls, response_cls))
    return pairs


_TS_IDENT_RE = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def render_rpc_request_map(pairs: list[tuple[str, type[BaseModel], type[BaseModel]]]) -> str:
    """Emit a TS type that maps each RPC discriminator literal to its
    `{ request, response }` pair. Consumers use this to type-link a
    `request(type, params)` call to its response shape."""
    out = ["export type RpcRequestMap = {"]
    for discriminator, req, res in pairs:
        # Prettier strips quotes around object keys that are valid identifiers;
        # match its style upfront so the file is stable on first pass.
        key = discriminator if _TS_IDENT_RE.match(discriminator) else render_literal(discriminator)
        out.append(f"  {key}: {{ request: {ts_name(req.__name__)}; response: {ts_name(res.__name__)} }}")
    out.append("}")
    return "\n".join(out)


# ─── Zod schema rendering ────────────────────────────────────────────


def render_zod_type(tp: Any) -> str:
    """Render a Python type annotation as a Zod schema expression. Mirrors
    `render_type` but emits `z.string()` etc. instead of TS types and
    references `<Name>Schema` instead of `<Name>`."""
    while get_origin(tp) is Annotated:
        tp = get_args(tp)[0]

    if isinstance(tp, typing.TypeVar):
        # Generics aren't expressible directly as Zod schemas; the
        # caller-side schema accepts `z.unknown()` for the type
        # parameter and the request map binds the actual shape.
        return "z.unknown()"

    origin = get_origin(tp)

    # Union types: T | U | None  →  z.union([T, U]).nullable()  (or .optional() at field level).
    # Dedup mirrors `render_type`: `int | float` collapses to `z.number()`.
    if origin in (Union, types.UnionType):
        args = list(get_args(tp))
        non_none = [a for a in args if a is not type(None)]
        has_none = type(None) in args
        rendered_unique: list[str] = []
        for a in non_none:
            r = render_zod_type(a)
            if r not in rendered_unique:
                rendered_unique.append(r)
        inner = rendered_unique[0] if len(rendered_unique) == 1 else f"z.union([{', '.join(rendered_unique)}])"
        return f"{inner}.nullable()" if has_none else inner

    if origin is Literal:
        members = get_args(tp)
        if len(members) == 1:
            return f"z.literal({render_literal(members[0])})"
        # Multiple string literals → z.enum is the idiomatic shape.
        if all(isinstance(m, str) for m in members):
            joined = ", ".join(render_literal(m) for m in members)
            return f"z.enum([{joined}])"
        return f"z.union([{', '.join(f'z.literal({render_literal(m)})' for m in members)}])"

    if origin is list:
        (inner,) = get_args(tp)
        return f"z.array({render_zod_type(inner)})"

    if origin is dict:
        k, v = get_args(tp)
        return f"z.record({render_zod_type(k)}, {render_zod_type(v)})"

    if tp is str:
        return "z.string()"
    if tp is bool:
        return "z.boolean()"
    if tp is int or tp is float:
        return "z.number()"
    if tp is bytes:
        return "z.string()"
    if tp is type(None):
        return "z.null()"

    if inspect.isclass(tp):
        if issubclass(tp, StrEnum):
            return f"{ts_name(tp.__name__)}Schema"
        if issubclass(tp, BaseModel):
            return f"{ts_name(tp.__name__)}Schema"

    raise NotImplementedError(f"Cannot render Zod schema for: {tp!r}")


# ─── Top-level ───────────────────────────────────────────────────────


def collect_all_decls(
    modules: list[ModuleType],
) -> tuple[
    list[type[StrEnum]],
    list[type[BaseModel]],
    list[tuple[str, list[type[BaseModel]]]],
    list[tuple[str, int | float | str | bool]],
]:
    """Walk multiple modules; concatenate their declarations preserving
    per-module order. Used to fold extra modules (`video_recorder` etc.)
    into the main `protocol` output as a single TS file."""
    enums: list[type[StrEnum]] = []
    models: list[type[BaseModel]] = []
    union_aliases: list[tuple[str, list[type[BaseModel]]]] = []
    constants: list[tuple[str, int | float | str | bool]] = []
    # Only the first module (the protocol module proper) contributes
    # exported constants — extras like `video_recorder` carry models but
    # their other module-level values are implementation details, not
    # part of the wire protocol.
    for i, m in enumerate(modules):
        m_enums, m_models, m_unions, m_consts = collect_module_decls(m, collect_constants=(i == 0))
        enums.extend(m_enums)
        models.extend(m_models)
        union_aliases.extend(m_unions)
        constants.extend(m_consts)
    return enums, models, union_aliases, constants


def render_constant(name: str, value: bool | int | float | str) -> str:  # noqa: FBT001  -- the value comes from a Python literal whose type is genuinely a primitive union; bool isn't a "trap" here, it's one valid wire-side primitive
    """Emit a `export const NAME = value` line for a module-level primitive."""
    if isinstance(value, bool):
        rendered = "true" if value else "false"
    elif isinstance(value, str):
        rendered = render_literal(value)
    else:
        rendered = str(value)
    return f"export const {name} = {rendered}"


def generate(modules: list[ModuleType]) -> str:
    enums, models, union_aliases, constants = collect_all_decls(modules)
    rpc_pairs = collect_rpc_pairs(models)

    sections: list[str] = [HEADER.rstrip(), "import { z } from 'zod'"]

    if constants:
        sections.append("// ─── Constants ────────────────────────────────────────────────────────")
        sections.extend(render_constant(name, value) for name, value in constants)

    if enums:
        sections.append("// ─── Enums ────────────────────────────────────────────────────────────")
        sections.extend(render_enum(enum_cls) for enum_cls in enums)

    if models:
        sections.append("// ─── Models ───────────────────────────────────────────────────────────")
        sections.extend(render_model(model_cls) for model_cls in models)

    if union_aliases:
        sections.append("// ─── Discriminated unions ─────────────────────────────────────────────")
        sections.extend(render_union_alias(name, members) for name, members in union_aliases)

    if rpc_pairs:
        sections.append("// ─── RPC request ↔ response map ───────────────────────────────────────")
        sections.append(render_rpc_request_map(rpc_pairs))

    return "\n\n".join(sections) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output path (default: %(default)s)")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if the output file would change. Used for CI freshness gates.",
    )
    args = parser.parse_args()

    modules: list[ModuleType] = [protocol, *EXTRA_MODULES]
    output = generate(modules)

    if args.check:
        if not args.output.exists() or args.output.read_text(encoding="utf-8") != output:
            print(
                f"[codegen] {args.output} is stale. Re-run `uv run python scripts/codegen_ts.py` and commit.",
                file=sys.stderr,
            )
            return 1
        print(f"[codegen] {args.output} is up to date.")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output, encoding="utf-8", newline="\n")
    print(f"[codegen] wrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
