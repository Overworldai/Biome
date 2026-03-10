import type { SynthOneShot } from './types'

export const synthError: SynthOneShot = (ctx, dest) => {
  // Low rumble
  const rumble = ctx.createOscillator()
  const rGain = ctx.createGain()
  rumble.type = 'sawtooth'
  rumble.frequency.setValueAtTime(55, ctx.currentTime)
  rGain.gain.setValueAtTime(0.1, ctx.currentTime)
  rGain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.15)
  rGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
  rumble.connect(rGain).connect(dest)
  rumble.start()
  rumble.stop(ctx.currentTime + 0.8)

  // Detuned chime
  for (const detune of [-30, 0, 25]) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(330, ctx.currentTime)
    osc.detune.setValueAtTime(detune, ctx.currentTime)
    g.gain.setValueAtTime(0.06, ctx.currentTime + 0.05)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.connect(g).connect(dest)
    osc.start(ctx.currentTime + 0.05)
    osc.stop(ctx.currentTime + 0.6)
  }
}

/** Gentle wind passing by — `scale` stretches timing (1 = default ~1.3s). */
const makeSwoosh =
  (scale: number): SynthOneShot =>
  (ctx, dest) => {
    const t = ctx.currentTime
    const s = scale

    const noise = ctx.createBufferSource()
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * (1.5 * s), ctx.sampleRate)
    const noiseData = noiseBuf.getChannelData(0)
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1
    noise.buffer = noiseBuf
    const bandpass = ctx.createBiquadFilter()
    bandpass.type = 'bandpass'
    bandpass.frequency.setValueAtTime(400, t)
    bandpass.frequency.exponentialRampToValueAtTime(1200, t + 0.4 * s)
    bandpass.frequency.exponentialRampToValueAtTime(500, t + 1.2 * s)
    bandpass.Q.setValueAtTime(0.4, t)
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(0, t)
    noiseGain.gain.linearRampToValueAtTime(0.15, t + 0.2 * s)
    noiseGain.gain.linearRampToValueAtTime(0.1, t + 0.6 * s)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 1.3 * s)
    noise.connect(bandpass).connect(noiseGain).connect(dest)
    noise.start()
  }

/** Short swoosh for background cycle transitions. */
export const synthPortalSwoosh = makeSwoosh(1)

/** Longer swoosh for portal entry/exit. */
export const synthPortalSwooshLong = makeSwoosh(1.5)
