/**
 * Audio engine: synthesized placeholder sounds + easy asset swap.
 *
 * To replace a synthesized sound with a real asset, add the file to
 * `assets/audio/` and register it in `SOUND_ASSETS` (in registry.ts).
 * The engine will prefer the asset file over the synthesizer. If the
 * asset fails to load, the synthesizer is used as a fallback.
 */

import type { SoundId, VolumeSettings } from './types'
import {
  SOUND_CATEGORIES,
  SOUND_ASSETS,
  SOUND_LOOP_VOLUMES,
  EXCLUSIVE_ONE_SHOT_GROUPS,
  SYNTH_ONE_SHOTS,
  SYNTH_LOOPS
} from './registry'

export class AudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private sfxGain: GainNode | null = null
  private musicGain: GainNode | null = null
  private assetBuffers = new Map<string, AudioBuffer>()
  private activeOneShots = new Map<SoundId, Set<AudioBufferSourceNode>>()
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
      // Mute before resuming, then ramp up to avoid a burst of buffered audio
      if (this.masterGain) {
        this.masterGain.gain.value = 0
      }
      this.resumePromise = this.ctx.resume().then(() => {
        this.resumePromise = null
        this.applyVolumes(0.15)
      })
    }
    return this.ctx
  }

  private applyVolumes(rampSeconds = 0.05) {
    const t = this.ctx?.currentTime ?? 0
    if (this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(t)
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t)
      this.masterGain.gain.linearRampToValueAtTime(this._masterVolume, t + rampSeconds)
    }
    if (this.sfxGain) {
      this.sfxGain.gain.cancelScheduledValues(t)
      this.sfxGain.gain.setValueAtTime(this.sfxGain.gain.value, t)
      this.sfxGain.gain.linearRampToValueAtTime(this._sfxVolume, t + rampSeconds)
    }
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(t)
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t)
      this.musicGain.gain.linearRampToValueAtTime(this._musicVolume, t + rampSeconds)
    }
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

  private getExclusiveOneShotGroup(id: SoundId): SoundId[] | null {
    return EXCLUSIVE_ONE_SHOT_GROUPS.find((group) => group.includes(id)) ?? null
  }

  private stopOneShotGroup(ids: SoundId[]) {
    for (const id of ids) {
      const activeSources = this.activeOneShots.get(id)
      if (!activeSources) continue
      for (const source of activeSources) {
        source.onended = null
        try {
          source.stop()
        } catch {
          // Source may have already ended.
        }
        source.disconnect()
      }
      activeSources.clear()
      this.activeOneShots.delete(id)
    }
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
    const exclusiveGroup = this.getExclusiveOneShotGroup(id)
    if (exclusiveGroup) {
      this.stopOneShotGroup(exclusiveGroup)
    }

    // Try asset buffer first
    const buffer = this.assetBuffers.get(id)
    if (buffer) {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(dest)
      const activeSources = this.activeOneShots.get(id) ?? new Set<AudioBufferSourceNode>()
      activeSources.add(source)
      this.activeOneShots.set(id, activeSources)
      source.onended = () => {
        const currentSources = this.activeOneShots.get(id)
        if (!currentSources) return
        currentSources.delete(source)
        if (currentSources.size === 0) {
          this.activeOneShots.delete(id)
        }
        source.disconnect()
      }
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
    const effectiveVolume = volume * (SOUND_LOOP_VOLUMES[id] ?? 1)

    // Per-loop gain node for individual volume control
    const loopGain = ctx.createGain()
    if (fadeInSeconds > 0) {
      loopGain.gain.setValueAtTime(0, ctx.currentTime)
      loopGain.gain.linearRampToValueAtTime(effectiveVolume, ctx.currentTime + fadeInSeconds)
    } else {
      loopGain.gain.setValueAtTime(effectiveVolume, ctx.currentTime)
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
