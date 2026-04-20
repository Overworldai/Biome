import { useEffect, useMemo, useState } from 'react'

const GOOSE_FACT_CYCLE_MS = 5200

const GOOSE_FACTS = [
  'Geese can sleep with one half of their brain awake to stay alert for danger.',
  'A migrating goose can fly over 1,500 miles in a single day with favorable winds.',
  'Goose families are tight-knit: both parents guard goslings during their first weeks.',
  'Canada geese use dozens of distinct calls to signal direction, danger, and regrouping.',
  'Flying in a V saves energy by sharing uplift from the wingtip vortices ahead.',
  'Many geese return to the same nesting area year after year.',
  'When one goose is injured, others may stay nearby instead of leaving it behind.',
  'Goose feathers are naturally water-resistant and excellent at trapping warmth.',
  'Goslings can swim within a day of hatching, often under close parental escort.',
  'Some goose species can fly at very high altitudes while crossing mountain ranges.',
  'Canada Goose numbers rebounded from major declines in the early 1900s through conservation and hunting rules.',
  'Cackling Goose used to be grouped with Canada Goose until ornithologists split them into separate species in 2004.',
  'There are seven recognized Canada Goose subspecies, including the very large giant Canada Goose.',
  'The giant Canada Goose was once thought extinct until a small population was rediscovered in Minnesota in 1962.',
  'Canada Geese tend to choose mates close to their own size and usually pair for life.',
  'Adult Canada Geese typically do not form breeding pairs until they are at least two years old.',
  'Older goslings sometimes travel in combined groups called gang broods watched over by adults.',
  'A defensive Canada Goose may hiss, spread its wings, pump its head, charge, or even fly at threats.',
  'Canada Geese do much of their feeding on land, especially on grasses, sedges, seeds, and berries.',
  'Geese eat aquatic plants and sometimes small aquatic animals such as mollusks or crustaceans.',
  'Migrating geese often stop in farm fields to feed on cultivated grains.',
  'When the lead bird in a V formation gets tired, it can rotate to the back so another bird takes over.',
  'Many Canada Geese in the lower 48 are now year-round residents rather than long-distance migrants.',
  'Far northern Canada Geese still make the long migrations that were once more typical for the species.',
  'One Canada Goose can carry roughly 20,000 to 25,000 feathers.',
  'Most of a goose feather coat is insulating down that helps it handle icy water and cold weather.',
  'Canada Geese replace all of their feathers through molt, and their wing feathers drop all at once in late summer.',
  'During a wing molt, a goose can be grounded for several weeks before new flight feathers grow in.',
  'Young geese can imprint on the first suitable moving figure they encounter and may stay attached to it long-term.',
  'Geese are highly social and often integrate well with other animals when raised around them.',
  'A female goose is a goose, a male is a gander, and airborne groups are often called skeins.',
  'Though they are waterfowl, geese spend much of their time on land.',
  'Geese may show grief-like behavior after losing a mate or a clutch of eggs.',
  'They often spend time preening, grazing, and collecting plant material to improve their nests.',
  'Geese form strong social bonds and can show clear affection toward others in their group.'
] as const

const makeSeed = () => Math.floor(Math.random() * 0x100000000)

const seededRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const shuffleWithSeed = <T,>(items: readonly T[], seed: number): T[] => {
  const random = seededRandom(seed)
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }
  return shuffled
}

export const GooseFactTicker = () => {
  const [gooseFactIndex, setGooseFactIndex] = useState(0)
  const [shuffleSeed] = useState(() => makeSeed())

  const activeTips = useMemo(() => shuffleWithSeed(GOOSE_FACTS, shuffleSeed), [shuffleSeed])

  useEffect(() => {
    if (activeTips.length < 2) return

    const timer = window.setInterval(() => {
      setGooseFactIndex((previous) => (previous + 1) % activeTips.length)
    }, GOOSE_FACT_CYCLE_MS)

    return () => window.clearInterval(timer)
  }, [activeTips])

  return (
    <div
      className="
        w-full text-center font-serif text-[2.35cqh] leading-[1.2] text-[rgba(233,242,255,0.86)]
        [text-shadow:0_0.12cqh_0.42cqh_rgba(0,0,0,0.42)]
      "
    >
      {activeTips[gooseFactIndex] ?? ''}
    </div>
  )
}
