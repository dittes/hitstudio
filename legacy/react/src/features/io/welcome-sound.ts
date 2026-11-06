import { getEngine } from '../../core/engine'

let stopCurrent: (() => void) | null = null

/** Original HitStudio motif: synthesized tones only, no recordings or sample packs. */
export function scheduleWelcomeSound(ctx: BaseAudioContext, destination: AudioNode): () => void {
  const out = ctx.createGain()
  out.gain.value = 0.28
  out.connect(destination)
  const delay = ctx.createDelay(1)
  delay.delayTime.value = 0.23
  const echo = ctx.createGain()
  echo.gain.value = 0.16
  out.connect(delay).connect(echo).connect(destination)
  const oscillators: OscillatorNode[] = []
  const gains: GainNode[] = []
  const start = ctx.currentTime + 0.025
  const notes = [[74, 0, .55], [78, .17, .6], [81, .35, .7], [85, .63, .9], [86, .91, 1.15]]
  for (const [midi, offset, duration] of notes) {
    for (const harmonic of [1, 2]) {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      const at = start + offset
      osc.type = 'sine'
      osc.frequency.value = 440 * 2 ** ((midi - 69) / 12) * harmonic
      env.gain.setValueAtTime(0, at)
      env.gain.linearRampToValueAtTime(harmonic === 1 ? .26 : .035, at + .012)
      env.gain.exponentialRampToValueAtTime(.0001, at + duration)
      osc.connect(env).connect(out)
      osc.start(at)
      osc.stop(at + duration + .02)
      oscillators.push(osc)
      gains.push(env)
    }
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    oscillators.forEach((osc) => { try { osc.stop() } catch { /* already ended */ }; osc.disconnect() })
    gains.forEach((gain) => gain.disconnect())
    out.disconnect(); delay.disconnect(); echo.disconnect()
  }
}

/** Call only from an explicit sound button, never during page load or recording. */
export async function playWelcomeSound(): Promise<void> {
  stopCurrent?.()
  const engine = getEngine()
  await engine.resume()
  stopCurrent?.()
  const stop = scheduleWelcomeSound(engine.ctx, engine.externalInput)
  stopCurrent = stop
  window.setTimeout(() => {
    stop()
    if (stopCurrent === stop) stopCurrent = null
  }, 2800)
}
