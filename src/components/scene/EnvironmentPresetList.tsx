import type { ReactNode } from 'react'
import { STYLED_SCROLLBAR } from '../../styles'

type EnvironmentOption = { label: string; icon: ReactNode; prompt: string }
type EnvironmentSection = { title: string; options: EnvironmentOption[] }

/** Shared SVG attribute set so the icons match in stroke width / cap
 *  style and pick up `currentColor` from their parent button. */
const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'h-[6cqh] w-[6cqh]'
} as const

// ─── Time of day ──────────────────────────────────────────────────────
const SunOnHorizonRising = (
  <svg {...ICON_PROPS}>
    <path d="M3 19h18" />
    <path d="M6 19a6 6 0 0 1 12 0" />
    <path d="M12 4v3" />
    <path d="M5 9l1.5 1.5" />
    <path d="M19 9l-1.5 1.5" />
  </svg>
)
const SunWithCloud = (
  <svg {...ICON_PROPS}>
    <circle cx="9" cy="9" r="3" />
    <path d="M9 3v2" />
    <path d="M3 9h2" />
    <path d="M5 5l1.4 1.4" />
    <path d="M14 12a4 4 0 0 1 4 4H8.5a3 3 0 0 1 .5-5.96" />
  </svg>
)
const SunWithRays = (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2" />
    <path d="M12 19v2" />
    <path d="M3 12h2" />
    <path d="M19 12h2" />
    <path d="M5.6 5.6l1.4 1.4" />
    <path d="M17 17l1.4 1.4" />
    <path d="M5.6 18.4l1.4-1.4" />
    <path d="M17 7l1.4-1.4" />
  </svg>
)
const SunLowAngle = (
  <svg {...ICON_PROPS}>
    <circle cx="9" cy="12" r="4" />
    <path d="M9 5v2" />
    <path d="M2 12h2" />
    <path d="M3.6 6.6l1.4 1.4" />
    <path d="M3.6 17.4l1.4-1.4" />
    <path d="M14 14h7" />
    <path d="M16 18h5" />
  </svg>
)
const SunOnHorizonSetting = (
  <svg {...ICON_PROPS}>
    <path d="M3 19h18" />
    <path d="M6 19a6 6 0 0 1 12 0" />
    <path d="M12 22v-3" />
    <path d="M19 16l-1.5-1.5" />
    <path d="M5 16l1.5-1.5" />
  </svg>
)
const Moon = (
  <svg {...ICON_PROPS}>
    <path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z" />
    <path d="M4 7v2" />
    <path d="M3 8h2" />
  </svg>
)

// ─── Weather ──────────────────────────────────────────────────────────
const SunBright = (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="5" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="M4.5 4.5l1.4 1.4" />
    <path d="M18.1 18.1l1.4 1.4" />
    <path d="M4.5 19.5l1.4-1.4" />
    <path d="M18.1 5.9l1.4-1.4" />
  </svg>
)
const Cloud = (
  <svg {...ICON_PROPS}>
    <path d="M17 18a4 4 0 0 0 0-8 6 6 0 0 0-11-2 4 4 0 0 0-1 8h12z" />
  </svg>
)
const CloudRain = (
  <svg {...ICON_PROPS}>
    <path d="M17 14a4 4 0 0 0 0-8 6 6 0 0 0-11-2 4 4 0 0 0-1 8h12z" />
    <path d="M8 18l-1 3" />
    <path d="M12 18l-1 3" />
    <path d="M16 18l-1 3" />
  </svg>
)
const CloudLightning = (
  <svg {...ICON_PROPS}>
    <path d="M17 14a4 4 0 0 0 0-8 6 6 0 0 0-11-2 4 4 0 0 0-1 8h12z" />
    <path d="M11 17l-2 4h3l-1 3 3-4h-2l1-3z" />
  </svg>
)
const CloudSnow = (
  <svg {...ICON_PROPS}>
    <path d="M17 14a4 4 0 0 0 0-8 6 6 0 0 0-11-2 4 4 0 0 0-1 8h12z" />
    <path d="M8 18v3" />
    <path d="M6.7 18.5l2.6 1.5" />
    <path d="M9.3 18.5l-2.6 1.5" />
    <path d="M16 18v3" />
    <path d="M14.7 18.5l2.6 1.5" />
    <path d="M17.3 18.5l-2.6 1.5" />
  </svg>
)
const Fog = (
  <svg {...ICON_PROPS}>
    <path d="M4 8h12" />
    <path d="M3 12h18" />
    <path d="M5 16h14" />
    <path d="M18 8h2" />
    <path d="M21 16h0" />
  </svg>
)

// ─── Events ───────────────────────────────────────────────────────────
const Wave = (
  <svg {...ICON_PROPS}>
    <path d="M2 13c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2" />
    <path d="M2 18c2 0 3-2 5-2s3 2 5 2 3-2 5-2 3 2 5 2" />
  </svg>
)
const Flame = (
  <svg {...ICON_PROPS}>
    <path d="M12 21c4 0 7-3 7-7 0-3-3-5-3-9 0 0-3 2-3 6-1.5-1.5-3-3-3-3s-4 3-4 7 3 6 6 6z" />
  </svg>
)
const Smoke = (
  <svg {...ICON_PROPS}>
    <path d="M5 9c2 0 3-2 6-2s4 2 6 2" />
    <path d="M3 14c2 0 3-2 6-2s4 2 6 2 3-2 6-2" />
    <path d="M3 19c2 0 3-2 6-2s4 2 6 2 3-2 6-2" />
  </svg>
)
const SandstormStreaks = (
  <svg {...ICON_PROPS}>
    <path d="M3 7l8 3" />
    <path d="M5 12l10 4" />
    <path d="M3 17l8 3" />
    <path d="M16 5l4 1.5" />
    <path d="M17 11l4 1.5" />
    <path d="M16 17l4 1.5" />
  </svg>
)
const RuinedHouse = (
  <svg {...ICON_PROPS}>
    <path d="M3 21h18" />
    <path d="M5 21V11l7-5 7 5v10" />
    <path d="M9 21v-5h2" />
    <path d="M15 12l-2 4l3 1l-1 4" />
  </svg>
)
const SnowMound = (
  <svg {...ICON_PROPS}>
    <path d="M2 19c4 0 6-5 10-5s6 5 10 5" />
    <path d="M12 5v6" />
    <path d="M9 7l6 0" />
    <path d="M9.5 5.5l5 5" />
    <path d="M14.5 5.5l-5 5" />
  </svg>
)

/** Pre-configured whole-scene edit prompts grouped by subcategory.
 *  Clicking a button fires `scene_edit` with `direct: true` so the
 *  prompt reaches Klein verbatim without the VLM tool-call round-trip
 *  (the prompts are already curated and don't need rewriting).
 *  Hardcoded in the frontend because the data is small, static, and
 *  image-less. Icons are emoji for now — easy to swap to SVG later. */
const ENVIRONMENT_SECTIONS: EnvironmentSection[] = [
  {
    title: 'Time of day',
    options: [
      {
        label: 'Dawn',
        icon: SunOnHorizonRising,
        prompt:
          'Change the time of day to dawn — soft pink and orange light at the horizon, the sun low, long shadows reaching across the scene.'
      },
      {
        label: 'Morning',
        icon: SunWithCloud,
        prompt:
          'Change the time of day to mid-morning — bright clean sunlight, blue sky with a few high clouds, warm tones.'
      },
      {
        label: 'Noon',
        icon: SunWithRays,
        prompt:
          'Change the time of day to noon — bright overhead sun, sharp contrast, short shadows directly under objects.'
      },
      {
        label: 'Afternoon',
        icon: SunLowAngle,
        prompt:
          'Change the time of day to late afternoon — warm golden-hour light raking across the scene, long shadows.'
      },
      {
        label: 'Dusk',
        icon: SunOnHorizonSetting,
        prompt:
          'Change the time of day to dusk — deep orange and purple sky, the sun just at the horizon, long warm shadows.'
      },
      {
        label: 'Night',
        icon: Moon,
        prompt:
          'Change the time of day to night — dark sky scattered with stars, cool blue moonlight casting deep shadows, any artificial lights now visibly glowing.'
      }
    ]
  },
  {
    title: 'Weather',
    options: [
      {
        label: 'Clear',
        icon: SunBright,
        prompt: 'Set the weather to clear — bright sun, blue sky, no clouds, crisp visibility, no precipitation.'
      },
      {
        label: 'Overcast',
        icon: Cloud,
        prompt:
          'Set the weather to overcast — uniform grey clouds covering the sky, soft diffuse light, no harsh shadows.'
      },
      {
        label: 'Rain',
        icon: CloudRain,
        prompt:
          'Set the weather to rainy — wet glistening surfaces, puddles forming on the ground, raindrops streaking through the air, low grey overcast sky.'
      },
      {
        label: 'Thunderstorm',
        icon: CloudLightning,
        prompt:
          'Set the weather to a heavy thunderstorm — dark roiling clouds, lightning flashing in the distance, torrential rain, dramatic lighting.'
      },
      {
        label: 'Snow',
        icon: CloudSnow,
        prompt:
          'Set the weather to snowy — snow accumulated on the ground and on every surface, snowflakes drifting through the air, pale grey sky.'
      },
      {
        label: 'Fog',
        icon: Fog,
        prompt:
          'Set the weather to dense fog — soft white haze across the scene, distant features dissolving into mist, low visibility.'
      }
    ]
  },
  {
    title: 'Events',
    options: [
      {
        label: 'Flooded',
        icon: Wave,
        prompt:
          'Flood the scene — water covering the ground up to roughly knee height, debris floating on the surface, reflections in the water.'
      },
      {
        label: 'On fire',
        icon: Flame,
        prompt:
          'Parts of the scene are on fire — orange and red flames, plumes of dark smoke rising, glowing embers in the air, scorch marks on nearby surfaces.'
      },
      {
        label: 'Heavy smoke',
        icon: Smoke,
        prompt:
          'Fill the scene with thick smoke — grey-brown haze obscuring distance, particulate floating in the air, washed-out colours.'
      },
      {
        label: 'Sandstorm',
        icon: SandstormStreaks,
        prompt:
          'Engulf the scene in a sandstorm — orange-tan dust filling the air, fine sand drifting across surfaces, dramatically reduced visibility.'
      },
      {
        label: 'Ruined',
        icon: RuinedHouse,
        prompt:
          'Make the scene look post-apocalyptic — rusted, abandoned, overgrown with weeds, scattered debris, cracked and broken surfaces.'
      },
      {
        label: 'Snow buried',
        icon: SnowMound,
        prompt:
          'Bury the scene in deep snow — surfaces and objects partially covered in snowdrifts, icicles, pale wintery light.'
      }
    ]
  }
]

type EnvironmentPresetListProps = {
  disabled: boolean
  onSelect: (prompt: string) => void
}

/** Vertical stack of subcategory headings + 3-column button grids,
 *  one row per environment section (Time of day / Weather / Events). */
const EnvironmentPresetList = ({ disabled, onSelect }: EnvironmentPresetListProps) => (
  <div
    className={`
      ${STYLED_SCROLLBAR}
      flex min-w-0 flex-1 flex-col gap-[1.4cqh] overflow-y-auto pr-[0.3cqw]
    `}
  >
    {ENVIRONMENT_SECTIONS.map((section) => (
      <div key={section.title} className="flex flex-col gap-[0.5cqh]">
        <h3 className="font-serif text-[1.9cqh] text-text-muted">{section.title}</h3>
        <div className="grid grid-cols-3 gap-[0.5cqh]">
          {section.options.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => onSelect(opt.prompt)}
              onMouseDown={(e) => e.preventDefault()}
              className="
                flex aspect-square flex-col items-center justify-center gap-[1cqh] bg-black/40 p-[0.5cqh_0.4cqw]
                text-center transition-colors
                hover:bg-black/60
                disabled:cursor-not-allowed disabled:opacity-50
              "
              disabled={disabled}
            >
              <span aria-hidden="true" className="text-text-primary">
                {opt.icon}
              </span>
              <span className="font-serif text-[1.7cqh] text-text-primary">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    ))}
  </div>
)

export default EnvironmentPresetList
