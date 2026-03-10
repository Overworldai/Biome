/**
 * Audio engine: synthesized placeholder sounds + easy asset swap.
 *
 * To replace a synthesized sound with a real asset, add the file to
 * `assets/audio/` and register it in `SOUND_ASSETS` (in registry.ts).
 * The engine will prefer the asset file over the synthesizer. If the
 * asset fails to load, the synthesizer is used as a fallback.
 */

import type { SoundId, VolumeSettings } from './types'
import { SOUND_CATEGORIES, SOUND_ASSETS, SYNTH_ONE_SHOTS, SYNTH_LOOPS } from './registry'

export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private musicGain: GainNode | null = null
  private assetBuffers = new Map<string, AudioBuffer>()
  private activeLoops = new Map<SoundId, { stop: () => void; gain: GainNode }>()
  private pendingLoops = new Map<SoundId, { volume: number }>()
  private _masterVolume = 1.0
  private _sfxVolume = 0.5
  private _musicVolume = 0.3
  private resumePromise: Promise<void> | null = null

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.masterGain = this.ctx.createGain()
      this.sfxGain = this.ctx.createGain()
      this.musicGain = this.ctx.createGain()
      this.sfxGain.connect(this.masterGain)
      this.musicGain.connect(this.masterGain)
      this.masterGain.connect(this.ctx.destination)
      this.applyVolumes()
    }
    if (this.ctx.state === 'suspended' && !this.resumePromise) {
      this.resumePromise = this.ctx.resume().then(() => {
        this.resumePromise = null
      })
    }
    return this.ctx
  }

  private applyVolumes() {
    if (this.masterGain) this.masterGain.gain.value = this._masterVolume
    if (this.sfxGain) this.sfxGain.gain.value = this._sfxVolume
    if (this.musicGain) this.musicGain.gain.value = this._musicVolume
  }

  get volumes(): VolumeSettings {
    return { master: this._masterVolume, sfx: this._sfxVolume, music: this._musicVolume }
  }

  setVolumes(update: Partial<VolumeSettings>) {
    if (update.master !== undefined) this._masterVolume = update.master
    if (update.sfx !== undefined) this._sfxVolume = update.sfx
    if (update.music !== undefined) this._musicVolume = update.music
    this.applyVolumes()
  }

  private getDestForCategory(cat: 'sfx' | 'music'): AudioNode {
    return cat === 'music' ? this.musicGain! : this.sfxGain!
  }

  /** Preload an asset file into a decoded AudioBuffer. */
  async preloadAsset(id: string, url: string): Promise<void> {
    try {
      const ctx = this.ensureContext()
      const resp = await fetch(url)
      if (!resp.ok) {
        console.warn(`[AudioEngine] Fetch failed for "${id}": ${resp.status} ${resp.statusText}`)
        return
      }
      const arrayBuf = await resp.arrayBuffer()
      const audioBuf = await ctx.decodeAudioData(arrayBuf)
      this.assetBuffers.set(id, audioBuf)
    } catch (err) {
      console.warn(`[AudioEngine] Failed to preload asset "${id}":`, err)
    }
  }

  /** Play a one-shot sound. */
  play(id: SoundId) {
    const ctx = this.ensureContext()
    const cat = SOUND_CATEGORIES[id]
    const dest = this.getDestForCategory(cat)

    // Try asset buffer first
    const buffer = this.assetBuffers.get(id)
    if (buffer) {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(dest)
      source.start()
      return
    }

    // Fall back to synthesizer
    const synth = SYNTH_ONE_SHOTS[id]
    if (synth) {
      synth(ctx, dest)
    }
  }

  /** Start a looping sound. Optionally fade in over `fadeInSeconds`. */
  startLoop(id: SoundId, volume = 1, fadeInSeconds = 0): boolean {
    if (this.activeLoops.has(id)) return false
    const ctx = this.ensureContext()
    const cat = SOUND_CATEGORIES[id]
    const dest = this.getDestForCategory(cat)

    // Per-loop gain node for individual volume control
    const loopGain = ctx.createGain()
    if (fadeInSeconds > 0) {
      loopGain.gain.setValueAtTime(0, ctx.currentTime)
      loopGain.gain.linearRampToValueAtTime(volume, ctx.currentTime + fadeInSeconds)
    } else {
      loopGain.gain.setValueAtTime(volume, ctx.currentTime)
    }
    loopGain.connect(dest)

    // Try asset buffer first
    const buffer = this.assetBuffers.get(id)
    if (buffer) {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.connect(loopGain)
      source.start()
      this.activeLoops.set(id, {
        gain: loopGain,
        stop: () => {
          source.stop()
          source.disconnect()
          loopGain.disconnect()
        }
      })
      return true
    }

    // Fall back to synthesizer
    const synthLoop = SYNTH_LOOPS[id]
    if (synthLoop) {
      const stop = synthLoop(ctx, loopGain)
      this.activeLoops.set(id, { gain: loopGain, stop })
      return true
    }

    loopGain.disconnect()

    // If there's a registered asset that hasn't loaded yet, remember this request
    if (SOUND_ASSETS[id]) {
      this.pendingLoops.set(id, { volume })
    }

    return false
  }

  /** Set volume of an active loop, with optional ramp time in seconds. */
  setLoopVolume(id: SoundId, volume: number, rampSeconds = 0) {
    const loop = this.activeLoops.get(id)
    if (!loop || !this.ctx) return
    if (rampSeconds > 0) {
      loop.gain.gain.cancelScheduledValues(this.ctx.currentTime)
      loop.gain.gain.setValueAtTime(loop.gain.gain.value, this.ctx.currentTime)
      loop.gain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + rampSeconds)
    } else {
      loop.gain.gain.setValueAtTime(volume, this.ctx.currentTime)
    }
  }

  /** Check if a loop is currently active. */
  isLoopActive(id: SoundId): boolean {
    return this.activeLoops.has(id)
  }

  /** Stop a looping sound immediately. */
  stopLoop(id: SoundId) {
    this.pendingLoops.delete(id)
    const loop = this.activeLoops.get(id)
    if (loop) {
      loop.stop()
      this.activeLoops.delete(id)
    }
  }

  /** Crossfade from one loop to another over `seconds`. */
  crossfadeLoop(from: SoundId, to: SoundId, seconds: number) {
    this.fadeOutLoop(from, seconds)
    this.startLoop(to, 1, seconds)
  }

  /** Fade out a looping sound over `seconds`, then clean up. */
  fadeOutLoop(id: SoundId, seconds: number) {
    this.pendingLoops.delete(id)
    const loop = this.activeLoops.get(id)
    if (!loop || !this.ctx) return
    // Ramp gain to zero
    loop.gain.gain.cancelScheduledValues(this.ctx.currentTime)
    loop.gain.gain.setValueAtTime(loop.gain.gain.value, this.ctx.currentTime)
    loop.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + seconds)
    // Remove from active immediately so a new loop with the same ID can start
    this.activeLoops.delete(id)
    // Clean up after fade completes
    setTimeout(
      () => {
        loop.stop()
      },
      seconds * 1000 + 100
    )
  }

  /** Stop all active loops. */
  stopAllLoops() {
    this.pendingLoops.clear()
    for (const [id] of this.activeLoops) {
      this.stopLoop(id)
    }
  }

  /** Preload all registered asset files. */
  async preloadAll(): Promise<void> {
    const entries = Object.entries(SOUND_ASSETS) as [SoundId, string][]
    await Promise.all(entries.map(([id, url]) => this.preloadAsset(id, url)))
    this.startPendingLoops()
  }

  /** Start any loops that were deferred because their asset wasn't loaded yet. */
  private startPendingLoops() {
    for (const [id, { volume }] of this.pendingLoops) {
      if (this.assetBuffers.has(id)) {
        this.pendingLoops.delete(id)
        this.startLoop(id, volume, 0.5)
      }
    }
  }
}
