# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "torch",
#     "transformers",
#     "accelerate",
#     "bitsandbytes",
#     "pillow",
#     "numpy",
#     "scipy",
#     "pydantic>=2",
#     "tqdm",
#     "gguf>=0.10.0",
#     "rembg[cpu]>=2.0.50",
#     "diffusers @ git+https://github.com/huggingface/diffusers",
# ]
# ///
"""Generate Scene Edit prop gallery images.

Dev-only authoring tool. Renders a curated catalogue of FPS-game-staple props
using a two-phase pipeline plus a background-removal post-pass:

  Phase 1 (studio thumbnails) — a fast text-to-image model.
  Phase 2 (held viewmodels)   — a quantised image-conditioned edit model
                                 (Q8 GGUF transformer + 4-bit text encoder)
                                 that reframes each studio shot into a grip.
  Post-pass                   — every render is run through rembg
                                 (BiRefNet-general-lite) to alpha-cut the
                                 model-baked white backdrop. Outputs are
                                 saved as PNG with transparency so the
                                 renderer can drop them on any panel
                                 colour without halos / shadow bleed.

Each holdable's held variant is derived from its studio image, so prop identity
is preserved across the pair. The phases are run sequentially and the GPU is
flushed between them to avoid loading both models simultaneously. The rembg
post-pass runs on CPU and slots in after each render synchronously.

A pydantic-validated manifest.json is (re)written alongside the images.
"""

from __future__ import annotations

import argparse
import fnmatch
import gc
import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
import torch  # pyright: ignore[reportMissingTypeStubs]  -- torch ships partial stubs
from diffusers import (  # pyright: ignore[reportMissingTypeStubs, reportUnknownVariableType]  -- diffusers stubs are partial
    Flux2KleinPipeline,
    Flux2Transformer2DModel,
    GGUFQuantizationConfig,
    ZImagePipeline,
)
from PIL import Image
from pydantic import BaseModel, ConfigDict
from rembg import new_session, remove  # pyright: ignore[reportMissingTypeStubs]
from scipy import ndimage  # pyright: ignore[reportMissingTypeStubs]  -- scipy ships partial stubs
from tqdm import tqdm
from transformers import (  # pyright: ignore[reportMissingTypeStubs]
    AutoModelForCausalLM,
    BitsAndBytesConfig,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = REPO_ROOT / "assets" / "scene_edit"
MANIFEST_PATH = ASSETS_DIR / "manifest.json"
STUDIO_MODEL_ID = "Tongyi-MAI/Z-Image-Turbo"
# rembg session model. birefnet-general-lite handles foliage and other
# fine/feathery edges cleanly while staying ~half the size of the full
# birefnet-general model. Runs on CPU at ~7-9 s/image.
REMBG_MODEL = "birefnet-general-lite"
EDIT_PIPELINE_REPO = "black-forest-labs/FLUX.2-klein-9B"
EDIT_TRANSFORMER_GGUF_URL = "https://huggingface.co/unsloth/FLUX.2-klein-9B-GGUF/blob/main/flux-2-klein-9b-Q8_0.gguf"
EDIT_NUM_STEPS = 4

Kind = Literal["spawnable", "holdable"]
Variant = Literal["studio", "held"]


@dataclass(frozen=True, slots=True)
class Prop:
    category: str
    slug: str
    kind: Kind
    prompt: str
    # Holdables only: long/heavy props that read better as a two-handed grip
    # (rifles, sledgehammer, axe, bat, chainsaw). Ignored for spawnables.
    two_handed: bool = False
    # Spawnables only: when true, render with a character/full-body studio
    # wrapper instead of the object wrapper (which says "no people").
    is_character: bool = False
    # When true, the rembg post-pass is replaced with an edge-only
    # flood-fill chroma cut: near-white pixels reachable from the image
    # edge become transparent, but interior near-white pixels (e.g. a
    # sky depicted inside a painting) stay opaque. Used for paintings,
    # where rembg's foreground segmentation otherwise latches onto the
    # depicted figure and strips the frame.
    chroma_cut: bool = False
    # Spawnables only: per-prop override for the video animation prompt
    # (forwarded to the video pipeline when the prop is spawned in
    # `video` mode). When None, falls back to the category template in
    # `DEFAULT_VIDEO_TEMPLATES`. Always None for holdables.
    video_prompt: str | None = None

    @property
    def id(self) -> str:
        return f"{self.category}/{self.slug}"


# Category-default video prompts. The video model needs motion to
# describe, but we want motion that's *direction-agnostic* — the FLF
# pipeline pins the endpoint composition, so a prompt like "speeds
# onto the scene from the left" specifies a direction the endpoints
# don't necessarily support and biases the model away from the
# constraint. Neutral arrival verbs ("arrives", "appears", "drops
# down") let the trained-FLF interpolation pick the path. The
# VIDEO_USE_VLM_PROMPT path (in `scene_authoring.py`) overrides these
# at request time with a VLM-authored description that sees both
# actual endpoints; these are the fallback when that flag is off.
DEFAULT_VIDEO_TEMPLATES: dict[str, str] = {
    "vehicles": "{subject} arrives in the scene.",
    "furniture": "{subject} appears in the scene.",
    "containers": "{subject} drops into the scene.",
    "paintings": "{subject} appears, hanging on a wall in the scene.",
    "electronics": "{subject} appears in the scene.",
    "foliage_and_rocks": "{subject} grows up out of the ground in the scene.",
    "industrial": "{subject} drops into the scene.",
    "npcs": "{subject} arrives in the scene.",
    "street": "{subject} drops into the scene.",
}


def derive_video_prompt(prop: Prop) -> str | None:
    """Resolve a prop's video animation prompt: use the per-prop override
    if provided, else fall back to the category template (interpolating
    `prop.prompt` as `{subject}`). Returns None for holdables — they're
    spawned into the player's hands, not animated into the world."""
    if prop.kind != "spawnable":
        return None
    if prop.video_prompt is not None:
        return prop.video_prompt
    template = DEFAULT_VIDEO_TEMPLATES.get(prop.category)
    if template is None:
        return None
    return template.format(subject=prop.prompt)


def _h(category: str, slug: str, prompt: str, *, two_handed: bool = False) -> Prop:
    return Prop(
        category=category,
        slug=slug,
        kind="holdable",
        prompt=prompt,
        two_handed=two_handed,
    )


def _s(category: str, slug: str, prompt: str, *, video_prompt: str | None = None) -> Prop:
    return Prop(category=category, slug=slug, kind="spawnable", prompt=prompt, video_prompt=video_prompt)


def _n(category: str, slug: str, prompt: str, *, video_prompt: str | None = None) -> Prop:
    """NPC/character: spawnable that uses the character studio wrapper."""
    return Prop(
        category=category,
        slug=slug,
        kind="spawnable",
        prompt=prompt,
        is_character=True,
        video_prompt=video_prompt,
    )


def _pa(slug: str, subject: str, *, video_prompt: str | None = None) -> Prop:
    """Painting helper: spawnable that bakes in the shared 'framed oil
    painting in an ornate gilded frame' phrasing and uses the edge-
    flooded chroma cut instead of rembg — rembg's BiRefNet treats the
    depicted figure as the foreground and strips the frame, which we
    want to keep."""
    return Prop(
        category="paintings",
        slug=slug,
        kind="spawnable",
        prompt=f"a framed oil painting in an ornate gilded frame depicting {subject}",
        chroma_cut=True,
        video_prompt=video_prompt,
    )


CATALOGUE: list[Prop] = [
    _h("weapons", "assault_rifle", "a modern military assault rifle", two_handed=True),
    _h("weapons", "ar15_carbine", "an AR-15 carbine rifle", two_handed=True),
    _h("weapons", "pump_shotgun", "a pump-action shotgun", two_handed=True),
    _h(
        "weapons",
        "sniper_rifle",
        "a bolt-action sniper rifle with a long scope",
        two_handed=True,
    ),
    _h("weapons", "smg", "a compact submachine gun", two_handed=True),
    _h("weapons", "revolver", "a steel revolver handgun"),
    _h(
        "weapons",
        "rocket_launcher",
        "a shoulder-fired rocket launcher",
        two_handed=True,
    ),
    _h("weapons", "combat_knife", "a tactical combat knife"),
    _h("weapons", "crowbar", "a red painted crowbar"),
    _h("weapons", "baseball_bat", "a wooden baseball bat", two_handed=True),
    _h(
        "weapons",
        "sledgehammer",
        "a heavy sledgehammer with a wooden handle",
        two_handed=True,
    ),
    _s("containers", "wooden_crate", "a weathered wooden shipping crate"),
    _s("containers", "oil_drum", "a rusty 55-gallon steel oil drum"),
    _s(
        "containers", "blue_chemical_barrel", "a blue plastic 55-gallon chemical barrel"
    ),
    _s("containers", "propane_tank", "a large white propane tank"),
    _s("containers", "shipping_container", "a rusted red 20-foot shipping container"),
    _s("containers", "gym_locker", "a tall blue metal single-door gym locker"),
    _s("containers", "dumpster", "a green metal industrial dumpster"),
    _s("furniture", "wooden_chair", "a simple wooden dining chair"),
    _s("furniture", "office_chair", "a black ergonomic office swivel chair"),
    _s("furniture", "fabric_sofa", "a beige three-seater fabric sofa"),
    _s("furniture", "leather_armchair", "a brown leather armchair"),
    _s("furniture", "wooden_desk", "a wooden office desk with drawers"),
    _s("furniture", "dining_table", "a rectangular wooden dining table"),
    _s("furniture", "bookshelf", "a tall wooden bookshelf filled with books"),
    _s("furniture", "dresser", "a four-drawer wooden dresser"),
    _s("furniture", "double_bed", "a double bed with a metal frame and white sheets"),
    _s("furniture", "filing_cabinet", "a beige four-drawer steel filing cabinet"),
    _s("furniture", "kitchen_cabinet", "a white kitchen wall cabinet"),
    _s(
        "furniture",
        "pool_table",
        "a green-felt pool table with corner pockets and wooden sides",
    ),
    _s(
        "furniture",
        "upright_piano",
        "a polished black upright piano with the lid closed",
    ),
    _s(
        "furniture",
        "foosball_table",
        "a wooden foosball table with red and blue players",
    ),
    _s("furniture", "whiteboard", "a wheeled office whiteboard on castors"),
    _s("furniture", "conference_table", "a long polished wooden conference room table"),
    _s(
        "furniture",
        "hospital_bed",
        "a hospital bed with adjustable side rails and a thin mattress",
    ),
    _s(
        "furniture", "ambulance_gurney", "a wheeled ambulance gurney with safety straps"
    ),
    # ─── Paintings ────────────────────────────────────────────────────
    # All share the "framed oil painting in an ornate gilded frame"
    # presentation; only the depicted subject varies. The `_pa` helper
    # bakes in that phrasing and skips the rembg post-pass (rembg
    # over-segments paintings, treating the depicted subject as the
    # foreground and stripping the frame).
    _pa("stormy_seascape", "a stormy seascape with a sailing ship being battered by towering waves"),
    _pa("pastoral_windmill", "a pastoral landscape of rolling green hills, a stone windmill, and grazing sheep"),
    _pa(
        "victorian_portrait",
        "a stern Victorian woman in a high-collar black dress and pearl earrings, three-quarter length portrait",
    ),
    _pa("fruit_still_life", "a still life of fruit, bread, a wine bottle, and a goblet on a draped table"),
    _pa("cavalry_battle", "a Napoleonic cavalry charge with drifting gunsmoke and tattered flags"),
    _pa("mountain_sunset", "an alpine mountain vista at sunset, peaks bathed in orange and purple light"),
    _pa(
        "gaslit_street_night",
        "a 19th-century gaslit cobblestone street at night, a horse-drawn carriage on rain-slicked stones",
    ),
    _pa("forest_stag", "a forest interior with a stag standing alert in a shaft of dawn sunlight"),
    _pa("descending_angels", "a baroque religious scene of angels descending from cloud-broken golden light"),
    _pa("hunters_marsh", "two 18th-century hunters with hounds at the edge of a misty marsh at dawn"),
    _s("electronics", "refrigerator", "a stainless steel double-door refrigerator"),
    _s("electronics", "gas_stove", "a freestanding white gas stove with oven"),
    _s("electronics", "washing_machine", "a white front-loading washing machine"),
    _s("electronics", "flatscreen_tv", "a modern flatscreen LCD television"),
    _s("electronics", "water_cooler", "an office water cooler with a blue jug"),
    _s("electronics", "vending_machine", "a red soda vending machine"),
    _h("electronics", "laptop", "an open silver laptop computer"),
    _s("electronics", "server_rack", "a black rack of 1U server units"),
    _s("electronics", "satellite_dish", "a small white satellite dish on a mount"),
    _s("electronics", "generator", "a yellow portable petrol generator"),
    _s(
        "electronics",
        "arcade_cabinet",
        "an upright Pac-Man-style arcade cabinet with a CRT screen and joystick",
    ),
    _s(
        "electronics",
        "pinball_machine",
        "a vintage pinball machine with a colourful backbox and flippers",
    ),
    _s(
        "electronics",
        "jukebox",
        "a classic 1960s diner jukebox with chrome trim and coloured lights",
    ),
    _s(
        "electronics",
        "copy_machine",
        "a beige office photocopier and printer with a paper tray",
    ),
    _s("street", "traffic_cone", "an orange and white traffic cone"),
    _s("street", "road_sign_stop", "a red metal STOP sign on a pole"),
    _s("street", "fire_hydrant", "a red painted fire hydrant"),
    _s("street", "mailbox", "a blue USPS street mailbox"),
    _s("street", "park_bench", "a green wood and iron park bench"),
    _s("street", "jersey_barrier", "a concrete jersey barrier road divider"),
    _s("street", "sandbag_stack", "a stacked wall of sandbags"),
    _s("street", "atm", "an outdoor ATM cash machine in a stainless steel housing"),
    _s("street", "bus_stop_shelter", "a glass-and-metal bus stop shelter with a bench"),
    _s("vehicles", "sedan_car", "a beige four-door sedan car"),
    _s("vehicles", "pickup_truck", "a red pickup truck"),
    _s("vehicles", "cargo_van", "a white cargo delivery van"),
    _s("vehicles", "sport_motorcycle", "a black sport motorcycle"),
    _s("vehicles", "mountain_bike", "a red mountain bike bicycle"),
    _s("vehicles", "shopping_cart", "a metal supermarket shopping cart"),
    _s("vehicles", "military_humvee", "a desert tan military Humvee"),
    _s("vehicles", "atv_quad", "a green four-wheeled ATV quad bike"),
    _s("vehicles", "forklift", "a yellow industrial forklift truck"),
    _s(
        "vehicles",
        "ambulance",
        "a white emergency ambulance with red and blue stripes",
    ),
    _s(
        "vehicles",
        "police_car",
        "a black and white police patrol car with a roof light bar",
    ),
    _s("vehicles", "school_bus", "a yellow American school bus"),
    _s(
        "vehicles",
        "garbage_truck",
        "a green municipal garbage truck with a rear loader",
    ),
    _s("vehicles", "military_tank", "an M1 Abrams main battle tank in desert tan"),
    _s("vehicles", "delivery_scooter", "a small red delivery scooter with a top box"),
    _s("foliage_and_rocks", "oak_tree", "a full-grown oak tree with green leaves"),
    _s("foliage_and_rocks", "pine_tree", "a tall pine tree"),
    _s("foliage_and_rocks", "dead_tree", "a leafless dead tree with bare branches"),
    _s("foliage_and_rocks", "leafy_shrub", "a round green leafy shrub"),
    _s("foliage_and_rocks", "tree_stump", "a freshly cut tree stump"),
    _s("foliage_and_rocks", "mossy_boulder", "a large mossy granite boulder"),
    _s("foliage_and_rocks", "gravel_pile", "a pile of grey gravel"),
    _s("foliage_and_rocks", "log_pile", "a stacked pile of split firewood logs"),
    _s("foliage_and_rocks", "hay_bale_round", "a large rolled cylindrical hay bale"),
    _h("industrial", "cordless_drill", "a yellow cordless power drill"),
    _h("industrial", "claw_hammer", "a wooden-handled claw hammer"),
    _h("industrial", "pipe_wrench", "a heavy steel pipe wrench"),
    _h("industrial", "chainsaw", "an orange and white petrol chainsaw", two_handed=True),
    _s("industrial", "extension_ladder", "an aluminium extension ladder"),
    _s("industrial", "wheelbarrow", "an orange single-wheel construction wheelbarrow"),
    _s("industrial", "brick_pile", "a stacked pile of red bricks"),
    _s("industrial", "rebar_bundle", "a bundle of rusty steel rebar rods"),
    _s(
        "industrial",
        "scaffolding_section",
        "a steel construction scaffolding section",
    ),
    _s("industrial", "wooden_pallet", "a wooden shipping pallet"),
    _s("industrial", "stack_of_tires", "a stack of black rubber car tires"),
    _s("industrial", "cable_spool", "a large wooden cable spool reel"),
    _s(
        "industrial",
        "hvac_rooftop_unit",
        "a beige rooftop HVAC air conditioning unit",
    ),
    _s("industrial", "portable_toilet", "a blue portable toilet port-a-potty"),
    _s(
        "industrial",
        "safe_heavy_floor",
        "a heavy black floor safe with a brass combination dial",
    ),
    _n(
        "npcs",
        "construction_worker",
        "a Latino male construction worker, stocky build, in an orange high-visibility vest, white hard hat, jeans, and work boots",
    ),
    _n(
        "npcs",
        "mechanic_jumpsuit",
        "a white male mechanic, average build, in a navy blue grease-stained work jumpsuit",
    ),
    _n(
        "npcs",
        "chef_white_uniform",
        "a South Asian male chef, heavyset build, in a white double-breasted jacket and a tall white toque hat",
    ),
    _n(
        "npcs",
        "doctor_lab_coat",
        "a Black male doctor, slim build, in a white lab coat over a shirt and tie, stethoscope around the neck",
    ),
    _n(
        "npcs",
        "nurse_scrubs",
        "a tall lean Middle Eastern male nurse in light blue medical scrubs with a stethoscope around the neck",
    ),
    _n(
        "npcs",
        "security_guard",
        "a tall muscular East Asian male security guard in a black uniform shirt with shoulder badges, peaked cap, and dark trousers",
    ),
    _n(
        "npcs",
        "janitor_uniform",
        "a short stocky white male janitor in grey work overalls and a baseball cap",
    ),
    _n(
        "npcs",
        "firefighter_turnout_gear",
        "a South Asian male firefighter, athletic build, in yellow turnout gear with reflective stripes and a yellow firefighter helmet",
    ),
    _n(
        "npcs",
        "delivery_courier",
        "a slim Black male delivery courier in a brown short-sleeve uniform with a baseball cap and a shoulder bag",
    ),
    _n(
        "npcs",
        "businessman_suit",
        "an East Asian male businessman, average build, in a charcoal grey suit, white shirt, and red tie",
    ),
    _n(
        "npcs",
        "jogger_sportswear",
        "a Middle Eastern male jogger, athletic build, in athletic shorts, a t-shirt, and running sneakers",
    ),
    _n(
        "npcs",
        "elderly_man_cane",
        "a slim elderly Latino man with a wooden walking cane, wearing a beige cardigan and slacks",
    ),
    _n(
        "npcs",
        "police_officer",
        "a stocky South Asian male police officer in a dark blue uniform with a peaked cap, badge, and duty belt",
    ),
    _n(
        "npcs",
        "swat_officer",
        "a Latino male SWAT officer, athletic build, in black tactical gear with a helmet, balaclava, and body armor",
    ),
    _n(
        "npcs",
        "soldier_modern_infantry",
        "a muscular Middle Eastern male modern infantry soldier in multicam fatigues, plate carrier, and combat helmet",
    ),
    _n(
        "npcs",
        "biker_cop",
        "a tall Black male motorcycle police officer, average build, in uniform with a white helmet, sunglasses, and tall riding boots",
    ),
    _n(
        "npcs",
        "gangster_leather_jacket",
        "a stocky white man in a black leather biker jacket, dark jeans, and a silver chain, urban gangster style",
    ),
    _n(
        "npcs",
        "masked_robber_balaclava",
        "a man of average build in a black balaclava completely covering his face, black hoodie, and dark trousers",
    ),
    _n(
        "npcs",
        "prisoner_orange_jumpsuit",
        "a heavyset white man in an orange prison jumpsuit",
    ),
]


# Phase 1 studio wrappers (text-to-image): split between spawnables and
# holdables. Spawnables get a centred composition — diagonals push bulky
# things like refrigerators and ATMs into awkward tilted angles. Holdables
# keep the diagonal so elongated props (rifles, bats) span the frame
# end-to-end. Both wrappers explicitly demand the entire object in-frame
# to discourage tight crops.

SPAWNABLE_STUDIO_WRAPPER = (
    "{prompt}, isolated on a pure white background, the entire object visible "
    "and centred with margin around all sides, photorealistic, soft even "
    "studio lighting, no shadow, no people, sharp focus, high detail, modern "
    "video game asset"
)

CHARACTER_STUDIO_WRAPPER = (
    "{prompt}, professional studio photograph, isolated on a pure white "
    "background, full body shown from head to toe with margin around all "
    "sides, neutral standing pose facing the camera, photorealistic, DSLR "
    "photography, soft even studio lighting, no shadow, sharp focus, high "
    "detail, realistic skin tones and fabric textures"
)

HOLDABLE_STUDIO_WRAPPER = (
    "{prompt}, isolated on a pure white background, composed on a diagonal "
    "axis from the lower-left to the upper-right of the frame, the entire "
    "prop visible from end to end with margin around it, photorealistic, "
    "soft even studio lighting, no shadow, no people, sharp focus, high "
    "detail, modern video game asset"
)

# Phase 2 held-edit prompts (image-conditioned): two variants — one-handed
# for pistols / knives / pickup-class items, two-handed for long/heavy props
# (rifles, sledgehammer, axe, bat, chainsaw). {subject} is the bare prop
# noun derived from the slug; the studio image carries the visual identity.
HELD_EDIT_PROMPT_ONE_HANDED = (
    "Reframe this image as a first-person shooter video game viewmodel "
    "with a right-handed grip. The player's right hand and forearm enter "
    "from the lower-right corner of the frame and grip the {subject}. "
    "The {subject} is held forward at arm's length, pointed forward away "
    "from the camera. The entire {subject} is visible in the frame. Keep "
    "the {subject}'s exact shape, finish, and details unchanged. Keep the "
    "background completely empty pure white with no environment, no HUD, "
    "no UI, no lens artifacts."
)

HELD_EDIT_PROMPT_TWO_HANDED = (
    "Reframe this image as a first-person shooter video game viewmodel "
    "with a right-handed grip. The player's right hand grips the primary "
    "handle, trigger, or rear of the {subject} and enters the frame from "
    "the lower-right corner; the left hand supports the {subject} further "
    "forward. Both arms enter the frame from below. The {subject} is held "
    "forward at chest level, pointed forward away from the camera. The "
    "entire {subject} is visible in the frame. Keep the {subject}'s exact "
    "shape, finish, and details unchanged. Keep the background completely "
    "empty pure white with no environment, no HUD, no UI, no lens artifacts."
)


def studio_prompt(prop: Prop) -> str:
    if prop.kind == "holdable":
        template = HOLDABLE_STUDIO_WRAPPER
    elif prop.is_character:
        template = CHARACTER_STUDIO_WRAPPER
    else:
        template = SPAWNABLE_STUDIO_WRAPPER
    return template.format(prompt=prop.prompt)


def held_edit_prompt(prop: Prop) -> str:
    subject = prop.slug.replace("_", " ")
    template = (
        HELD_EDIT_PROMPT_TWO_HANDED if prop.two_handed else HELD_EDIT_PROMPT_ONE_HANDED
    )
    return template.format(subject=subject)


class ManifestEntry(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    slug: str
    kind: Kind
    image: str
    held_image: str | None
    # Resolved video animation prompt (per-prop override or category
    # template). Null for holdables and any spawnable category that
    # doesn't have a template.
    video_prompt: str | None


class Manifest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    categories: dict[str, list[ManifestEntry]]


def build_manifest(catalogue: list[Prop]) -> Manifest:
    by_category: dict[str, list[ManifestEntry]] = {}
    for prop in catalogue:
        held = (
            f"{prop.category}/{prop.slug}_held.png" if prop.kind == "holdable" else None
        )
        entry = ManifestEntry(
            slug=prop.slug,
            kind=prop.kind,
            image=f"{prop.category}/{prop.slug}.png",
            held_image=held,
            video_prompt=derive_video_prompt(prop),
        )
        by_category.setdefault(prop.category, []).append(entry)
    for entries in by_category.values():
        entries.sort(key=lambda e: e.slug)
    return Manifest(categories=by_category)


def write_manifest(catalogue: list[Prop]) -> None:
    manifest = build_manifest(catalogue)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        manifest.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )


def output_path(prop: Prop, variant: Variant) -> Path:
    suffix = "_held" if variant == "held" else ""
    return ASSETS_DIR / prop.category / f"{prop.slug}{suffix}.png"


VariantArg = Literal["studio", "held", "both"]


def variants_for(prop: Prop, variant_arg: VariantArg) -> list[Variant]:
    if variant_arg == "studio":
        return ["studio"]
    if variant_arg == "held":
        return ["held"] if prop.kind == "holdable" else []
    return ["studio", "held"] if prop.kind == "holdable" else ["studio"]


def derive_seed(prop: Prop, variant: Variant, offset: int) -> int:
    digest = hashlib.sha256(f"{prop.id}/{variant}".encode()).digest()
    return (int.from_bytes(digest[:8], "big") + offset) & 0x7FFFFFFF


class UnknownSelectionError(Exception):
    pass


def select_props(
    catalogue: list[Prop],
    ids: list[str],
    categories: list[str],
    kind: Kind | None,
) -> list[Prop]:
    selected = list(catalogue)
    if kind is not None:
        selected = [p for p in selected if p.kind == kind]
    if categories:
        known = {p.category for p in catalogue}
        unknown = set(categories) - known
        if unknown:
            raise UnknownSelectionError(
                f"Unknown categories: {', '.join(sorted(unknown))}"
            )
        cat_set = set(categories)
        selected = [p for p in selected if p.category in cat_set]
    if ids:
        matched: list[Prop] = []
        seen: set[str] = set()
        for pattern in ids:
            hits = [p for p in selected if fnmatch.fnmatch(p.id, pattern)]
            if not hits:
                raise UnknownSelectionError(f"No props match pattern: {pattern}")
            for prop in hits:
                if prop.id not in seen:
                    seen.add(prop.id)
                    matched.append(prop)
        selected = matched
    return selected


@dataclass(frozen=True, slots=True)
class Job:
    prop: Prop
    variant: Variant
    path: Path


def plan_jobs(selected: list[Prop], variant_arg: VariantArg) -> list[Job]:
    jobs: list[Job] = []
    for prop in selected:
        for variant in variants_for(prop, variant_arg):
            jobs.append(
                Job(prop=prop, variant=variant, path=output_path(prop, variant))
            )
    return jobs


def load_studio_pipeline() -> ZImagePipeline:
    print(f"loading studio model {STUDIO_MODEL_ID} on cuda (bfloat16)…", file=sys.stderr)
    pipe: ZImagePipeline = ZImagePipeline.from_pretrained(  # pyright: ignore[reportUnknownMemberType]
        STUDIO_MODEL_ID,
        torch_dtype=torch.bfloat16,
        low_cpu_mem_usage=False,
    )
    pipe.to("cuda")  # pyright: ignore[reportUnknownMemberType]
    return pipe


_REMBG_SESSION: object | None = None


def _get_rembg_session() -> object:
    """Lazy singleton for the rembg session — first access downloads the
    BiRefNet ONNX weights (~500 MB) into ~/.u2net/."""
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        print(f"loading rembg session ({REMBG_MODEL})…", file=sys.stderr)
        _REMBG_SESSION = new_session(REMBG_MODEL)
    return _REMBG_SESSION


def _save_with_alpha_cut(image: Image.Image, dest: Path) -> None:
    """Run the rembg post-pass on a freshly-rendered RGB image and save
    the result as a transparent PNG. Server-side compositing reconstructs
    the white background when this image is later sent to Klein as a
    reference, so the alpha cut buys us cleaner edges (no shadows /
    halos / bleed) on both sides."""
    rgb = image.convert("RGB")
    cut = remove(rgb, session=_get_rembg_session())  # pyright: ignore[reportUnknownVariableType]
    dest.parent.mkdir(parents=True, exist_ok=True)
    cut.save(dest, format="PNG")  # pyright: ignore[reportUnknownMemberType]


def _save_with_chroma_cut(image: Image.Image, dest: Path) -> None:
    """Edge-only flood-fill chroma key, then save as transparent PNG.

    Near-white pixels are detected (RGB ≥ 240); connected components
    that touch any image edge become alpha=0, while interior near-white
    pixels (sky inside a painting, white shirt, etc.) stay opaque. This
    is deterministic and frame-preserving, unlike rembg's saliency
    segmentation which can strip a painting's frame in favour of the
    depicted figure."""
    rgba = image.convert("RGBA")
    arr = np.array(rgba)
    rgb = arr[:, :, :3]
    white = (rgb >= 240).all(axis=2)

    labeled, _ = ndimage.label(white)  # pyright: ignore[reportUnknownArgumentType]

    edge_labels: set[int] = set()
    edge_labels.update(int(v) for v in np.unique(labeled[0, :]))
    edge_labels.update(int(v) for v in np.unique(labeled[-1, :]))
    edge_labels.update(int(v) for v in np.unique(labeled[:, 0]))
    edge_labels.update(int(v) for v in np.unique(labeled[:, -1]))
    edge_labels.discard(0)

    edge_connected = np.isin(labeled, list(edge_labels))
    arr[edge_connected, 3] = 0

    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(dest, format="PNG")


def render_studio(pipe: ZImagePipeline, prop: Prop, seed: int, dest: Path) -> None:
    generator = torch.Generator("cuda").manual_seed(seed)
    result = pipe(  # pyright: ignore[reportUnknownVariableType, reportCallIssue]
        prompt=studio_prompt(prop),
        height=1024,
        width=1024,
        num_inference_steps=9,
        guidance_scale=0.0,
        generator=generator,
    )
    image = result.images[0]  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    if prop.chroma_cut:
        _save_with_chroma_cut(image, dest)
    else:
        _save_with_alpha_cut(image, dest)


def load_edit_pipeline() -> Flux2KleinPipeline:
    """Load the held-edit pipeline (Q8 GGUF transformer + 4-bit text encoder).

    Mirrors the memory-saving pattern in `server-components/engine/scene_authoring.py`
    (which uses a smaller variant at runtime). Resident memory is ~13 GB —
    fits a 32 GB GPU comfortably alongside other processes.
    """
    print("loading edit-model Q8 GGUF transformer…", file=sys.stderr)
    gguf_config = GGUFQuantizationConfig(compute_dtype=torch.bfloat16)
    transformer = Flux2Transformer2DModel.from_single_file(  # pyright: ignore[reportUnknownMemberType]
        EDIT_TRANSFORMER_GGUF_URL,
        config=EDIT_PIPELINE_REPO,
        subfolder="transformer",
        quantization_config=gguf_config,
        torch_dtype=torch.bfloat16,
    )
    print("loading edit-model 4-bit text encoder…", file=sys.stderr)
    bnb_config = BitsAndBytesConfig(load_in_4bit=True)
    text_encoder = AutoModelForCausalLM.from_pretrained(  # pyright: ignore[reportUnknownMemberType]
        EDIT_PIPELINE_REPO,
        subfolder="text_encoder",
        quantization_config=bnb_config,
        torch_dtype=torch.bfloat16,
    )
    print(f"building edit pipeline from {EDIT_PIPELINE_REPO}…", file=sys.stderr)
    pipe: Flux2KleinPipeline = Flux2KleinPipeline.from_pretrained(  # pyright: ignore[reportUnknownMemberType]
        EDIT_PIPELINE_REPO,
        transformer=transformer,
        text_encoder=text_encoder,
        torch_dtype=torch.bfloat16,
    ).to("cuda")  # pyright: ignore[reportUnknownMemberType]
    return pipe


def _aligned(h: int, w: int) -> tuple[int, int]:
    return h // 16 * 16, w // 16 * 16


def render_held(pipe: Flux2KleinPipeline, prop: Prop, source: Path, dest: Path) -> None:
    # The studio source is a transparent PNG; Klein needs RGB input, so
    # composite onto white before passing it in. (Same compositing the
    # server does at runtime — keeps the reference Klein sees consistent.)
    studio_pil = Image.open(source).convert("RGBA")
    bg = Image.new("RGB", studio_pil.size, (255, 255, 255))
    bg.paste(studio_pil, mask=studio_pil.split()[3])
    image = bg

    h, w = _aligned(image.height, image.width)
    if (image.height, image.width) != (h, w):
        image = image.resize((w, h), Image.Resampling.LANCZOS)
    result = pipe(  # pyright: ignore[reportUnknownVariableType, reportCallIssue]
        image=image,
        prompt=held_edit_prompt(prop),
        num_inference_steps=EDIT_NUM_STEPS,
        height=h,
        width=w,
    )
    out = result.images[0]  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    _save_with_alpha_cut(out, dest)


def _free_gpu() -> None:
    """Drop CUDA caches between phases so the next pipeline can load."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate Scene Edit prop gallery images via a two-phase pipeline "
            "(text-to-image studios, image-conditioned edit for held viewmodels)."
        ),
    )
    parser.add_argument(
        "ids", nargs="*", help="Prop IDs (category/slug); fnmatch globs allowed."
    )
    parser.add_argument(
        "--category",
        action="append",
        default=[],
        help="Restrict to category (repeatable).",
    )
    parser.add_argument("--kind", choices=("spawnable", "holdable"), default=None)
    parser.add_argument("--variant", choices=("studio", "held", "both"), default="both")
    parser.add_argument(
        "--list", action="store_true", help="List the catalogue and exit."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print resolved paths without rendering."
    )
    parser.add_argument(
        "--force", action="store_true", help="Re-render even if output exists."
    )
    parser.add_argument("--seed-offset", type=int, default=0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.list:
        for prop in CATALOGUE:
            print(f"{prop.id} [{prop.kind}]")
        return 0

    try:
        selected = select_props(CATALOGUE, args.ids, args.category, args.kind)
    except UnknownSelectionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if not selected:
        print("no props selected", file=sys.stderr)
        return 1

    jobs = plan_jobs(selected, args.variant)

    if args.dry_run:
        for job in jobs:
            print(f"{job.prop.id} [{job.variant}] -> {job.path.relative_to(REPO_ROOT)}")
        write_manifest(CATALOGUE)
        print(f"manifest -> {MANIFEST_PATH.relative_to(REPO_ROOT)}", file=sys.stderr)
        return 0

    todo = [j for j in jobs if args.force or not j.path.exists()]
    if not todo:
        print(
            "nothing to do (all outputs exist; pass --force to regenerate)",
            file=sys.stderr,
        )
        write_manifest(CATALOGUE)
        return 0

    studio_jobs = [j for j in todo if j.variant == "studio"]
    held_jobs = [j for j in todo if j.variant == "held"]
    written = 0

    # Phase 1: text-to-image studio thumbnails.
    if studio_jobs:
        studio_pipe = load_studio_pipeline()
        for job in tqdm(studio_jobs, desc="studio", unit="img"):
            seed = derive_seed(job.prop, job.variant, args.seed_offset)
            render_studio(studio_pipe, job.prop, seed, job.path)
        written += len(studio_jobs)
        del studio_pipe
        _free_gpu()

    # Phase 2: image-conditioned edit of each studio shot into a held
    # viewmodel, so the prop's visual identity is preserved across the pair.
    if held_jobs:
        # Held edit reads the studio image — it must already exist on disk.
        ready: list[Job] = []
        for job in held_jobs:
            studio_path = output_path(job.prop, "studio")
            if not studio_path.exists():
                print(
                    f"error: {job.prop.id} held variant requires studio image at "
                    f"{studio_path.relative_to(REPO_ROOT)}, which is missing. "
                    f"Render the studio first with --variant studio or --variant both.",
                    file=sys.stderr,
                )
                return 2
            ready.append(job)

        edit_pipe = load_edit_pipeline()
        for job in tqdm(ready, desc="held", unit="img"):
            studio_path = output_path(job.prop, "studio")
            render_held(edit_pipe, job.prop, studio_path, job.path)
        written += len(ready)
        del edit_pipe
        _free_gpu()

    write_manifest(CATALOGUE)
    print(
        f"wrote {written} image(s); manifest -> {MANIFEST_PATH.relative_to(REPO_ROOT)}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
