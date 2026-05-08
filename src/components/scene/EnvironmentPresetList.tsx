import { STYLED_SCROLLBAR } from '../../styles'

type EnvironmentOption = { label: string; prompt: string }
type EnvironmentSection = { title: string; options: EnvironmentOption[] }

/** Pre-configured whole-scene edit prompts grouped by subcategory.
 *  Clicking a button fires `scene_edit` with `direct: true` so the
 *  prompt reaches Klein verbatim without the VLM tool-call round-trip
 *  (the prompts are already curated and don't need rewriting).
 *  Hardcoded in the frontend because the data is small, static, and
 *  image-less. */
const ENVIRONMENT_SECTIONS: EnvironmentSection[] = [
  {
    title: 'Time of day',
    options: [
      {
        label: 'Dawn',
        prompt:
          'Change the time of day to dawn — soft pink and orange light at the horizon, the sun low, long shadows reaching across the scene.'
      },
      {
        label: 'Morning',
        prompt:
          'Change the time of day to mid-morning — bright clean sunlight, blue sky with a few high clouds, warm tones.'
      },
      {
        label: 'Noon',
        prompt:
          'Change the time of day to noon — bright overhead sun, sharp contrast, short shadows directly under objects.'
      },
      {
        label: 'Afternoon',
        prompt:
          'Change the time of day to late afternoon — warm golden-hour light raking across the scene, long shadows.'
      },
      {
        label: 'Dusk',
        prompt:
          'Change the time of day to dusk — deep orange and purple sky, the sun just at the horizon, long warm shadows.'
      },
      {
        label: 'Night',
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
        prompt: 'Set the weather to clear — bright sun, blue sky, no clouds, crisp visibility, no precipitation.'
      },
      {
        label: 'Overcast',
        prompt:
          'Set the weather to overcast — uniform grey clouds covering the sky, soft diffuse light, no harsh shadows.'
      },
      {
        label: 'Rain',
        prompt:
          'Set the weather to rainy — wet glistening surfaces, puddles forming on the ground, raindrops streaking through the air, low grey overcast sky.'
      },
      {
        label: 'Thunderstorm',
        prompt:
          'Set the weather to a heavy thunderstorm — dark roiling clouds, lightning flashing in the distance, torrential rain, dramatic lighting.'
      },
      {
        label: 'Snow',
        prompt:
          'Set the weather to snowy — snow accumulated on the ground and on every surface, snowflakes drifting through the air, pale grey sky.'
      },
      {
        label: 'Fog',
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
        prompt:
          'Flood the scene — water covering the ground up to roughly knee height, debris floating on the surface, reflections in the water.'
      },
      {
        label: 'On fire',
        prompt:
          'Parts of the scene are on fire — orange and red flames, plumes of dark smoke rising, glowing embers in the air, scorch marks on nearby surfaces.'
      },
      {
        label: 'Heavy smoke',
        prompt:
          'Fill the scene with thick smoke — grey-brown haze obscuring distance, particulate floating in the air, washed-out colours.'
      },
      {
        label: 'Sandstorm',
        prompt:
          'Engulf the scene in a sandstorm — orange-tan dust filling the air, fine sand drifting across surfaces, dramatically reduced visibility.'
      },
      {
        label: 'Ruined',
        prompt:
          'Make the scene look post-apocalyptic — rusted, abandoned, overgrown with weeds, scattered debris, cracked and broken surfaces.'
      },
      {
        label: 'Snow buried',
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
                bg-black/40 p-[0.7cqh_0.5cqw] text-center font-serif text-[1.8cqh] text-text-primary transition-colors
                hover:bg-black/60
                disabled:cursor-not-allowed disabled:opacity-50
              "
              disabled={disabled}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    ))}
  </div>
)

export default EnvironmentPresetList
