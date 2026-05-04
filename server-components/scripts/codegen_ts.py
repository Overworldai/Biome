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

from server import protocol

DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent.parent / "src" / "types" / "protocol.generated.ts"
DEFAULT_ZOD_OUTPUT = Path(__file__).resolve().parent.parent.parent / "src" / "types" / "protocol.zod.ts"

HEADER = """\
// THIS FILE IS GENERATED. DO NOT EDIT BY HAND.
//
// Source:    server-components/server/protocol.py
// Regenerate: cd server-components && uv run python scripts/codegen_ts.py
//
// CI fails if this file is stale relative to its source. If you change
// the Python protocol, re-run the codegen and commit the result.
"""

ZOD_HEADER = """\
// THIS FILE IS GENERATED. DO NOT EDIT BY HAND.
//
// Source:    server-components/server/protocol.py
// Regenerate: cd server-components && uv run python scripts/codegen_ts.py
//
// Runtime validators paired with `protocol.generated.ts`. Each schema
// asserts `satisfies z.ZodType<T>` against the matching type so any
// drift between this file and the type definitions is a tsc error.
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

    # Union types: T | U | None  →  T | U | null  (with null only if None present)
    if origin in (Union, types.UnionType):
        args = list(get_args(tp))
        has_none = type(None) in args
        non_none = [a for a in args if a is not type(None)]
        rendered = " | ".join(render_type(a) for a in non_none)
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
    """Output is shaped to be Prettier-clean against the project's
    config (single quotes, no trailing semicolons, 120-char width)."""
    out: list[str] = [
        *render_docstring(enum_cls),
        f"export type {ts_name(enum_cls.__name__)} =",
        *(f"  | {render_literal(member.value)}" for member in enum_cls),
    ]
    return "\n".join(out)


def render_model(model_cls: type[BaseModel]) -> str:
    out: list[str] = []
    out.extend(render_docstring(model_cls))

    # Generic params
    type_params = getattr(model_cls, "__type_params__", ())
    name = ts_name(model_cls.__name__)
    if type_params:
        param_names = [tp.__name__ for tp in type_params]
        name = f"{name}<{', '.join(param_names)}>"

    out.append(f"export interface {name} {{")

    for field_name, field_info in model_cls.model_fields.items():
        if is_wire_optional(field_info):
            # Strip `| None` only when the wire-optional comes from `T | None = None`;
            # for non-None defaults we keep the type as-is (the consumer either omits
            # the field or sends a real value, never null).
            ann = field_info.annotation
            if field_info.default is None and type(None) in get_args(ann):
                ann = strip_none_from_annotation(ann)
            rendered = render_type(ann)
            out.append(f"  {field_name}?: {rendered}")
        else:
            rendered = render_type(field_info.annotation)
            out.append(f"  {field_name}: {rendered}")

    out.append("}")
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
    """Match Prettier's wrap-or-collapse behaviour: single line if it
    fits in 120 chars, one-per-line otherwise."""
    member_names = [ts_name(m.__name__) for m in members]
    single_line = f"export type {ts_name(name)} = {' | '.join(member_names)}"
    if len(single_line) <= PRETTIER_LINE_WIDTH:
        return single_line
    return "\n".join([f"export type {ts_name(name)} =", *(f"  | {n}" for n in member_names)])


# ─── Module walker ───────────────────────────────────────────────────


def collect_module_decls(
    module: ModuleType,
) -> tuple[list[type[StrEnum]], list[type[BaseModel]], list[tuple[str, list[type[BaseModel]]]]]:
    """Walk a module; return (enums, models, union_aliases) preserving
    declaration order. Skips re-exports from other modules and private names."""
    enums: list[type[StrEnum]] = []
    models: list[type[BaseModel]] = []
    union_aliases: list[tuple[str, list[type[BaseModel]]]] = []

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

    return enums, models, union_aliases


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

    # Union types: T | U | None  →  z.union([T, U]).nullable()  (or .optional() at field level)
    if origin in (Union, types.UnionType):
        args = list(get_args(tp))
        non_none = [a for a in args if a is not type(None)]
        has_none = type(None) in args
        if len(non_none) == 1:
            inner = render_zod_type(non_none[0])
        else:
            inner = f"z.union([{', '.join(render_zod_type(a) for a in non_none)}])"
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


def render_zod_enum(enum_cls: type[StrEnum]) -> str:
    """Wrap each enum member on its own line — Prettier always wraps
    long array literals at the project's line width and the on-disk
    file should match what Prettier would produce on first pass.
    The project's `.prettierrc` sets `trailingComma: "none"`, so the
    last member doesn't get a trailing comma."""
    name = ts_name(enum_cls.__name__)
    members = list(enum_cls)
    out = [f"export const {name}Schema = z.enum(["]
    for i, m in enumerate(members):
        terminator = "" if i == len(members) - 1 else ","
        out.append(f"  {render_literal(m.value)}{terminator}")
    out.append(f"]) satisfies z.ZodType<{name}>")
    return "\n".join(out)


def render_zod_model(model_cls: type[BaseModel]) -> str:
    """Emit `export const FooSchema = z.object({...}) satisfies z.ZodType<Foo>`.

    Generic models (`__type_params__` non-empty) are rendered as plain
    `z.object` without the `satisfies` clause — the type parameter
    can't be expressed in Zod's runtime type, and we don't need full
    payload validation for the only generic case (`RpcSuccessResponse`)
    since the request map binds its `data` shape elsewhere."""
    name = ts_name(model_cls.__name__)
    is_generic = bool(getattr(model_cls, "__type_params__", ()))

    fields = list(model_cls.model_fields.items())
    out = [f"export const {name}Schema = z.object({{"]
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
    if is_generic:
        out.append("})")
    else:
        out.append(f"}}) satisfies z.ZodType<{name}>")
    return "\n".join(out)


def render_zod_union(name: str, members: list[type[BaseModel]]) -> str:
    """Render a discriminated union schema. All members must carry a
    `type: Literal["..."]` discriminator; the codegen guarantees this
    for every union it emits. Wrapped one-per-line to match what
    Prettier would produce for any union past ~3 members."""
    member_schemas = [f"{ts_name(m.__name__)}Schema" for m in members]
    inline = f"z.discriminatedUnion('type', [{', '.join(member_schemas)}])"
    inline_wrapper = f"export const {ts_name(name)}Schema = {inline} satisfies z.ZodType<{ts_name(name)}>"
    if len(inline_wrapper) <= PRETTIER_LINE_WIDTH:
        return inline_wrapper
    out = [f"export const {ts_name(name)}Schema = z.discriminatedUnion('type', ["]
    for i, schema in enumerate(member_schemas):
        terminator = "" if i == len(member_schemas) - 1 else ","
        out.append(f"  {schema}{terminator}")
    out.append(f"]) satisfies z.ZodType<{ts_name(name)}>")
    return "\n".join(out)


def generate_zod(module: ModuleType) -> str:
    enums, models, union_aliases = collect_module_decls(module)

    sections: list[str] = [ZOD_HEADER.rstrip()]

    # Imports: zod runtime + every generated type we'll reference in `satisfies`.
    type_names: list[str] = []
    type_names.extend(ts_name(e.__name__) for e in enums)
    type_names.extend(ts_name(m.__name__) for m in models if not getattr(m, "__type_params__", ()))
    type_names.extend(ts_name(name) for name, _ in union_aliases)
    type_names = sorted(set(type_names))

    sections.append("import { z } from 'zod'")
    if type_names:
        sections.append(
            "import type {\n" + ",\n".join(f"  {n}" for n in type_names) + "\n} from './protocol.generated'"
        )

    if enums:
        sections.append("// ─── Enums ────────────────────────────────────────────────────────────")
        sections.extend(render_zod_enum(enum_cls) for enum_cls in enums)

    if models:
        sections.append("// ─── Models ───────────────────────────────────────────────────────────")
        sections.extend(render_zod_model(model_cls) for model_cls in models)

    if union_aliases:
        sections.append("// ─── Discriminated unions ─────────────────────────────────────────────")
        sections.extend(render_zod_union(name, members) for name, members in union_aliases)

    return "\n\n".join(sections) + "\n"


# ─── Top-level ───────────────────────────────────────────────────────


def generate(module: ModuleType) -> str:
    enums, models, union_aliases = collect_module_decls(module)
    rpc_pairs = collect_rpc_pairs(models)

    sections: list[str] = [HEADER.rstrip()]

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
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Type output (default: %(default)s)")
    parser.add_argument(
        "--zod-output", type=Path, default=DEFAULT_ZOD_OUTPUT, help="Zod schema output (default: %(default)s)"
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if either output file would change. Used for CI freshness gates.",
    )
    args = parser.parse_args()

    outputs = [
        (args.output, generate(protocol)),
        (args.zod_output, generate_zod(protocol)),
    ]

    if args.check:
        stale: list[Path] = []
        for path, content in outputs:
            if not path.exists() or path.read_text() != content:
                stale.append(path)
        if stale:
            for path in stale:
                print(
                    f"[codegen] {path} is stale. Re-run `uv run python scripts/codegen_ts.py` and commit.",
                    file=sys.stderr,
                )
            return 1
        for path, _ in outputs:
            print(f"[codegen] {path} is up to date.")
        return 0

    for path, content in outputs:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        print(f"[codegen] wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
