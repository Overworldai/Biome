import type { SynthLoop } from './types'
import { loopTeardown } from './synthUtils'

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
