import type { SynthOneShot } from './types'

export const synthUIHover: SynthOneShot = (ctx, dest) => {
  const t = ctx.currentTime

  // Soft tonal hint
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(1200, t)
  osc.frequency.exponentialRampToValueAtTime(1300, t + 0.03)
  gain.gain.setValueAtTime(0.04, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
  osc.connect(gain).connect(dest)
  osc.start()
  osc.stop(t + 0.04)

  // Light noise tick
  const noise = ctx.createBufferSource()
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.008, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3
  noise.buffer = buf
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.setValueAtTime(3000, t)
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0.06, t)
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012)
  noise.connect(hp).connect(ng).connect(dest)
  noise.start()
}

export const synthUIClick: SynthOneShot = (ctx, dest) => {
  const t = ctx.currentTime

  // Short tonal body — minimal sweep so it doesn't sound arcade-y
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(400, t)
  osc.frequency.exponentialRampToValueAtTime(350, t + 0.04)
  gain.gain.setValueAtTime(0.1, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
  osc.connect(gain).connect(dest)
  osc.start()
  osc.stop(t + 0.05)

  // Click transient — the main character of the sound
  const noise = ctx.createBufferSource()
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.015, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5
  noise.buffer = buf
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.setValueAtTime(2000, t)
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0.12, t)
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02)
  noise.connect(hp).connect(ng).connect(dest)
  noise.start()
}

export const synthUIBack: SynthOneShot = (ctx, dest) => {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(900, ctx.currentTime)
  osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.12)
  gain.gain.setValueAtTime(0.08, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
  osc.connect(gain).connect(dest)
  osc.start()
  osc.stop(ctx.currentTime + 0.12)
}

export const synthToggleOn: SynthOneShot = (ctx, dest) => synthToggle(ctx, dest, true)
export const synthToggleOff: SynthOneShot = (ctx, dest) => synthToggle(ctx, dest, false)

function synthToggle(ctx: AudioContext, dest: AudioNode, on: boolean) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  if (on) {
    osc.frequency.setValueAtTime(800, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.07)
  } else {
    osc.frequency.setValueAtTime(1200, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.07)
  }
  gain.gain.setValueAtTime(0.09, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09)
  osc.connect(gain).connect(dest)
  osc.start()
  osc.stop(ctx.currentTime + 0.09)
}
