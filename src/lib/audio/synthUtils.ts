/** Shared cleanup helper for loop synths — fades out gain nodes then stops/disconnects everything. */
export function loopTeardown(gains: GainNode[], nodes: AudioNode[], fadeSeconds: number): () => void {
  return () => {
    const t = gains[0]?.context?.currentTime ?? 0
    for (const g of gains) {
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(g.gain.value, t)
      g.gain.linearRampToValueAtTime(0, t + fadeSeconds)
    }
    setTimeout(
      () => {
        for (const n of nodes) {
          try {
            if (n instanceof OscillatorNode || n instanceof AudioBufferSourceNode) (n as OscillatorNode).stop()
            n.disconnect()
          } catch {
            // Already stopped/disconnected
          }
        }
      },
      fadeSeconds * 1000 + 100
    )
  }
}
