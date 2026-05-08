# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "torch",
#     "transformers",
#     "accelerate",
#     "bitsandbytes",
#     "pillow",
#     "pydantic>=2",
#     "tqdm",
#     "gguf>=0.10.0",
#     "diffusers @ git+https://github.com/huggingface/diffusers",
# ]
# ///
"""Generate Scene Edit prop gallery images.

Dev-only authoring tool. Renders a curated catalogue of FPS-game-staple props
on a white background using a two-phase pipeline:

  Phase 1 (studio thumbnails) — a fast text-to-image model.
  Phase 2 (held viewmodels)   — a quantised image-conditioned edit model
                                 (Q8 GGUF transformer + 4-bit text encoder)
                                 that reframes each studio shot into a grip.

Each holdable's held variant is derived from its studio image, so prop identity
is preserved across the pair. The phases are run sequentially and the GPU is
flushed between them to avoid loading both models simultaneously.

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

import torch  # pyright: ignore[reportMissingTypeStubs]  -- torch ships partial stubs
from diffusers import (  # pyright: ignore[reportMissingTypeStubs, reportUnknownVariableType]  -- diffusers stubs are partial
    Flux2KleinPipeline,
    Flux2Transformer2DModel,
    GGUFQuantizationConfig,
    ZImagePipeline,
)
from PIL import Image
from pydantic import BaseModel, ConfigDict
from tqdm import tqdm
from transformers import (  # pyright: ignore[reportMissingTypeStubs]
    AutoModelForCausalLM,
    BitsAndBytesConfig,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = REPO_ROOT / "assets" / "scene_edit"
MANIFEST_PATH = ASSETS_DIR / "manifest.json"
STUDIO_MODEL_ID = "Tongyi-MAI/Z-Image-Turbo"
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

    @property
    def id(self) -> str:
        return f"{self.category}/{self.slug}"


def _h(category: str, slug: str, prompt: str, *, two_handed: bool = False) -> Prop:
    return Prop(
        category=category,
        slug=slug,
        kind="holdable",
        prompt=prompt,
        two_handed=two_handed,
    )


def _s(category: str, slug: str, prompt: str) -> Prop:
    return Prop(category=category, slug=slug, kind="spawnable", prompt=prompt)


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
    _h("weapons", "pistol", "a modern semi-automatic pistol"),
    _h("weapons", "revolver", "a steel revolver handgun"),
    _h(
        "weapons",
        "rocket_launcher",
        "a shoulder-fired rocket launcher",
        two_handed=True,
    ),
    _h("weapons", "combat_knife", "a tactical combat knife"),
    _h("weapons", "crowbar", "a red painted crowbar"),
    _h("weapons", "fire_axe", "a fireman's red and yellow fire axe", two_handed=True),
    _h("weapons", "baseball_bat", "a wooden baseball bat", two_handed=True),
    _h(
        "weapons",
        "sledgehammer",
        "a heavy sledgehammer with a wooden handle",
        two_handed=True,
    ),
    _s("containers", "wooden_crate", "a weathered wooden shipping crate"),
    _s("containers", "metal_ammo_crate", "an olive drab metal ammunition crate"),
    _s("containers", "oil_drum", "a rusty 55-gallon steel oil drum"),
    _s(
        "containers", "blue_chemical_barrel", "a blue plastic 55-gallon chemical barrel"
    ),
    _s("containers", "propane_tank", "a large white propane tank"),
    _s("containers", "oxygen_tank", "a green compressed oxygen cylinder"),
    _s("containers", "jerry_can", "a red metal jerry can fuel container"),
    _s("containers", "cardboard_box", "a stacked cardboard moving box"),
    _s("containers", "shipping_container", "a rusted red 20-foot shipping container"),
    _s("containers", "gym_locker", "a tall blue metal single-door gym locker"),
    _s("containers", "footlocker", "a green military footlocker chest"),
    _s("containers", "dumpster", "a green metal industrial dumpster"),
    _s("containers", "trash_can", "a dented metal trash can with a lid"),
    _s("furniture", "wooden_chair", "a simple wooden dining chair"),
    _s("furniture", "office_chair", "a black ergonomic office swivel chair"),
    _s("furniture", "fabric_sofa", "a beige three-seater fabric sofa"),
    _s("furniture", "leather_armchair", "a brown leather armchair"),
    _s("furniture", "wooden_desk", "a wooden office desk with drawers"),
    _s("furniture", "dining_table", "a rectangular wooden dining table"),
    _s("furniture", "bookshelf", "a tall wooden bookshelf filled with books"),
    _s("furniture", "dresser", "a four-drawer wooden dresser"),
    _s("furniture", "double_bed", "a double bed with a metal frame and white sheets"),
    _s("furniture", "nightstand", "a small wooden bedside nightstand with a lamp"),
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
    _s(
        "furniture",
        "framed_painting",
        "a framed oil painting in an ornate gilded frame",
    ),
    _s(
        "furniture",
        "wall_clock_round",
        "a round white office wall clock with black hands and numerals",
    ),
    _s("furniture", "area_rug", "a patterned persian-style red and blue area rug"),
    _s("appliances", "refrigerator", "a stainless steel double-door refrigerator"),
    _s("appliances", "microwave", "a black countertop microwave oven"),
    _s("appliances", "gas_stove", "a freestanding white gas stove with oven"),
    _s("appliances", "washing_machine", "a white front-loading washing machine"),
    _s("appliances", "crt_television", "a 90s beige CRT television set"),
    _s("appliances", "flatscreen_tv", "a modern flatscreen LCD television"),
    _s("appliances", "coffee_maker", "a black drip coffee maker with a glass carafe"),
    _s("appliances", "water_cooler", "an office water cooler with a blue jug"),
    _s("appliances", "vending_machine", "a red soda vending machine"),
    _h("electronics", "laptop", "an open silver laptop computer"),
    _s("electronics", "desktop_computer", "a beige desktop computer tower"),
    _s("electronics", "crt_monitor", "a 90s beige CRT computer monitor"),
    _s("electronics", "server_rack", "a black rack of 1U server units"),
    _s("electronics", "rotary_telephone", "a black 1980s rotary desk telephone"),
    _s("electronics", "cctv_camera", "a wall-mounted CCTV security camera"),
    _s("electronics", "radio_transceiver", "a HAM radio base station transceiver"),
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
    _s("electronics", "cash_register", "a vintage NCR brass mechanical cash register"),
    _s(
        "electronics",
        "copy_machine",
        "a beige office photocopier and printer with a paper tray",
    ),
    _h("lighting", "flashlight", "a black metal tactical flashlight"),
    _h("lighting", "road_flare", "a lit red emergency road flare"),
    _s("lighting", "desk_lamp", "an articulated black desk lamp"),
    _s("lighting", "floor_lamp", "a tall floor-standing lamp with a fabric shade"),
    _s("lighting", "neon_open_sign", "a glowing red neon OPEN sign"),
    _s("lighting", "traffic_signal", "a three-light traffic signal on a metal arm"),
    _s("street", "traffic_cone", "an orange and white traffic cone"),
    _s("street", "road_sign_stop", "a red metal STOP sign on a pole"),
    _s("street", "fire_hydrant", "a red painted fire hydrant"),
    _s("street", "mailbox", "a blue USPS street mailbox"),
    _s("street", "park_bench", "a green wood and iron park bench"),
    _s("street", "jersey_barrier", "a concrete jersey barrier road divider"),
    _s("street", "sandbag_stack", "a stacked wall of sandbags"),
    _s("street", "atm", "an outdoor ATM cash machine in a stainless steel housing"),
    _s("street", "bus_stop_shelter", "a glass-and-metal bus stop shelter with a bench"),
    _s(
        "street", "gravestone", "a weathered grey granite gravestone with a rounded top"
    ),
    _s(
        "street",
        "fire_extinguisher_red",
        "a red wall-mounted fire extinguisher with a black hose",
    ),
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
        "vehicles", "ambulance", "a white emergency ambulance with red and blue stripes"
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
    _s("foliage_and_rocks", "fern_clump", "a clump of green ferns"),
    _s("foliage_and_rocks", "tree_stump", "a freshly cut tree stump"),
    _s("foliage_and_rocks", "mossy_boulder", "a large mossy granite boulder"),
    _s("foliage_and_rocks", "gravel_pile", "a pile of grey gravel"),
    _s("foliage_and_rocks", "log_pile", "a stacked pile of split firewood logs"),
    _s(
        "foliage_and_rocks",
        "potted_plant_indoor",
        "a tall leafy potted houseplant in a terracotta pot",
    ),
    _s("foliage_and_rocks", "hay_bale_round", "a large rolled cylindrical hay bale"),
    _h("food_and_drink", "soda_can", "a generic red aluminium soda can"),
    _h("food_and_drink", "beer_bottle", "a brown glass beer bottle"),
    _h("food_and_drink", "glass_wine_bottle", "a green glass wine bottle"),
    _h("food_and_drink", "pizza_box", "a closed cardboard pizza takeaway box"),
    _h(
        "food_and_drink",
        "takeout_container",
        "a white styrofoam takeaway food container",
    ),
    _h("food_and_drink", "energy_drink_can", "a tall energy drink can"),
    _h("food_and_drink", "water_bottle", "a clear plastic bottle of mineral water"),
    _h("food_and_drink", "can_of_beans", "a tin can of baked beans with a paper label"),
    _h("tools", "cordless_drill", "a yellow cordless power drill"),
    _h("tools", "claw_hammer", "a wooden-handled claw hammer"),
    _h("tools", "pipe_wrench", "a heavy steel pipe wrench"),
    _h("tools", "chainsaw", "an orange and white petrol chainsaw", two_handed=True),
    _s("tools", "extension_ladder", "an aluminium extension ladder"),
    _s("tools", "wheelbarrow", "an orange single-wheel construction wheelbarrow"),
    _s("industrial_debris", "concrete_block", "a grey cinder block concrete brick"),
    _s("industrial_debris", "brick_pile", "a stacked pile of red bricks"),
    _s("industrial_debris", "rebar_bundle", "a bundle of rusty steel rebar rods"),
    _s(
        "industrial_debris",
        "scaffolding_section",
        "a steel construction scaffolding section",
    ),
    _s("industrial_debris", "metal_pipe", "a section of rusted steel pipe"),
    _s("industrial_debris", "wooden_pallet", "a wooden shipping pallet"),
    _s("industrial_debris", "stack_of_tires", "a stack of black rubber car tires"),
    _s("industrial_debris", "cable_spool", "a large wooden cable spool reel"),
    _s("industrial_debris", "plywood_sheet", "a 4x8 sheet of plywood"),
    _s(
        "industrial_debris",
        "hvac_rooftop_unit",
        "a beige rooftop HVAC air conditioning unit",
    ),
    _s(
        "industrial_debris",
        "electrical_box",
        "a grey utility electrical junction box on a wall",
    ),
    _s("industrial_debris", "portable_toilet", "a blue portable toilet port-a-potty"),
    _s(
        "industrial_debris",
        "pipe_valve_wheel",
        "a large red industrial pipe valve wheel",
    ),
    _s(
        "industrial_debris",
        "safe_heavy_floor",
        "a heavy black floor safe with a brass combination dial",
    ),
    _s(
        "industrial_debris",
        "rolling_suitcase",
        "a black hard-shell rolling suitcase with a telescopic handle",
    ),
    _s(
        "industrial_debris",
        "duffel_bag",
        "a black canvas duffel bag with carrying straps",
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
    template = (
        HOLDABLE_STUDIO_WRAPPER if prop.kind == "holdable" else SPAWNABLE_STUDIO_WRAPPER
    )
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


class Manifest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    categories: dict[str, list[ManifestEntry]]


def build_manifest(catalogue: list[Prop]) -> Manifest:
    by_category: dict[str, list[ManifestEntry]] = {}
    for prop in catalogue:
        held = (
            f"{prop.category}/{prop.slug}_held.jpg" if prop.kind == "holdable" else None
        )
        entry = ManifestEntry(
            slug=prop.slug,
            kind=prop.kind,
            image=f"{prop.category}/{prop.slug}.jpg",
            held_image=held,
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
    return ASSETS_DIR / prop.category / f"{prop.slug}{suffix}.jpg"


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
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.save(dest, format="JPEG", quality=92)  # pyright: ignore[reportUnknownMemberType]


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
    image = Image.open(source).convert("RGB")
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
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, format="JPEG", quality=92)  # pyright: ignore[reportUnknownMemberType]


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
