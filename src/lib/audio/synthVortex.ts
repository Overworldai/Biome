import type { SynthLoop } from './types'
import { loopTeardown } from './synthUtils'

/**
 * Builds a vortex tunnel sound. The core character is rushing air with
 * resonant sweeps that create a sense of forward motion. Tonal elements
 * sit underneath as a subtle drone.
 *  - 'normal': smooth rushing wind with warm resonance
 *  - 'error':  harsher, more turbulent — same tunnel, gone wrong
 */
function buildVortexLoop(ctx: AudioContext, dest: AudioNode, variant: 'normal' | 'error'): () => void {
  const nodes: AudioNode[] = []
  const gains: GainNode[] = []
  const t = ctx.currentTime
  const isError = variant === 'error'

  // --- Layer 1: Rushing air (primary) ---
  const wind = ctx.createBufferSource()
  const windBuf = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = windBuf.getChannelData(ch)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  wind.buffer = windBuf
  wind.loop = true

  const windBP = ctx.createBiquadFilter()
  windBP.type = 'bandpass'
  windBP.frequency.setValueAtTime(isError ? 600 : 680, t)
  windBP.Q.setValueAtTime(0.8, t)

  const windGain = ctx.createGain()
  windGain.gain.setValueAtTime(0.14, t)
  wind.connect(windBP).connect(windGain).connect(dest)
  wind.start()
  nodes.push(wind, windBP, windGain)
  gains.push(windGain)

  // --- Layer 2: High whistle / tunnel resonance ---
  const whistle = ctx.createBufferSource()
  const whistleBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate)
  const whistleData = whistleBuf.getChannelData(0)
  for (let i = 0; i < whistleData.length; i++) whistleData[i] = Math.random() * 2 - 1
  whistle.buffer = whistleBuf
  whistle.loop = true

  const whistleBP = ctx.createBiquadFilter()
  whistleBP.type = 'bandpass'
  whistleBP.frequency.setValueAtTime(isError ? 1500 : 1800, t)
  whistleBP.Q.setValueAtTime(2, t)

  // Offset sweep so the two bands don't move in sync
  const whistleLfo = ctx.createOscillator()
  const whistleDepth = ctx.createGain()
  whistleLfo.type = 'sine'
  whistleLfo.frequency.setValueAtTime(isError ? 0.073 : 0.06, t)
  whistleDepth.gain.setValueAtTime(isError ? 700 : 600, t)
  whistleLfo.connect(whistleDepth).connect(whistleBP.frequency)
  whistleLfo.start()

  const whistleGain = ctx.createGain()
  whistleGain.gain.setValueAtTime(isError ? 0.05 : 0.04, t)
  whistle.connect(whistleBP).connect(whistleGain).connect(dest)
  whistle.start()
  nodes.push(whistle, whistleBP, whistleLfo, whistleDepth, whistleGain)
  gains.push(whistleGain)

  // --- Layer 3: Subtle tonal undertone ---
  const drone = ctx.createOscillator()
  const droneGain = ctx.createGain()
  drone.type = 'sine'
  drone.frequency.setValueAtTime(isError ? 50 : 60, t)
  droneGain.gain.setValueAtTime(isError ? 0.07 : 0.04, t)
  drone.connect(droneGain).connect(dest)
  drone.start()
  nodes.push(drone, droneGain)
  gains.push(droneGain)

  return loopTeardown(gains, nodes, 0.5)
}

/** Rushing-through-a-tunnel vortex loop. */
export const synthVortexLoop: SynthLoop = (ctx, dest) => buildVortexLoop(ctx, dest, 'normal')

/** Harsher, turbulent variant of the vortex for error states. */
export const synthVortexError: SynthLoop = (ctx, dest) => buildVortexLoop(ctx, dest, 'error')

/** Warm energy hum for portal hover — like standing near something powerful. */
export const synthPortalHum: SynthLoop = (ctx, dest) => {
  const nodes: AudioNode[] = []
  const gains: GainNode[] = []
  const t = ctx.currentTime

  // Deep fundamental — felt more than heard
  const fund = ctx.createOscillator()
  const fundGain = ctx.createGain()
  fund.type = 'sine'
  fund.frequency.setValueAtTime(50, t)
  fundGain.gain.setValueAtTime(0.08, t)
  fund.connect(fundGain).connect(dest)
  fund.start()
  nodes.push(fund, fundGain)
  gains.push(fundGain)

  // Second harmonic for warmth
  const harm = ctx.createOscillator()
  const harmGain = ctx.createGain()
  harm.type = 'sine'
  harm.frequency.setValueAtTime(100, t)
  harmGain.gain.setValueAtTime(0.04, t)
  harm.connect(harmGain).connect(dest)
  harm.start()
  nodes.push(harm, harmGain)
  gains.push(harmGain)

  // Very slow amplitude breathing — energy pulsing gently
  const breathLfo = ctx.createOscillator()
  const breathDepth = ctx.createGain()
  breathLfo.type = 'sine'
  breathLfo.frequency.setValueAtTime(0.06, t)
  breathDepth.gain.setValueAtTime(0.02, t)
  breathLfo.connect(breathDepth).connect(fundGain.gain)
  breathLfo.connect(breathDepth).connect(harmGain.gain)
  breathLfo.start()
  nodes.push(breathLfo, breathDepth)

  // Faint high-frequency shimmer — energy crackling at the edge of hearing
  const shimmer = ctx.createBufferSource()
  const shimBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate)
  const shimData = shimBuf.getChannelData(0)
  for (let i = 0; i < shimData.length; i++) shimData[i] = Math.random() * 2 - 1
  shimmer.buffer = shimBuf
  shimmer.loop = true

  const shimBP = ctx.createBiquadFilter()
  shimBP.type = 'bandpass'
  shimBP.frequency.setValueAtTime(3000, t)
  shimBP.Q.setValueAtTime(1.5, t)

  const shimGain = ctx.createGain()
  shimGain.gain.setValueAtTime(0.012, t)
  shimmer.connect(shimBP).connect(shimGain).connect(dest)
  shimmer.start()
  nodes.push(shimmer, shimBP, shimGain)
  gains.push(shimGain)

  return loopTeardown(gains, nodes, 0.3)
}
