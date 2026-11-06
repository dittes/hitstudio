import { Pause, Play, SkipBack, Volume2 } from 'lucide-react'
import { getEngine } from '../../core/engine'
import { formatTime } from '../../core/ids'
import { projectDuration, useStore } from '../../core/store'
import { toast } from '../../core/toast'
import { useDJ } from '../dj/state'

/** Compact arrangement controls remain available when the studio chrome is hidden. */
export function ImmersivePlayer() {
  const name = useStore((s) => s.project.name)
  const duration = useStore((s) => projectDuration(s.project))
  const position = useStore((s) => s.transport.position)
  const playing = useStore((s) => s.transport.playing)
  const volume = useStore((s) => s.project.master.volume)
  const djPlaying = useDJ((s) => s.decks.some((d) => d.playing))
  if (!duration || djPlaying) return null
  const toggle = () => {
    if (playing) getEngine().pause()
    else void getEngine().play(position >= duration ? 0 : undefined).catch(() => toast('Audio could not start.'))
  }
  return (
    <section className="vz-player" aria-label="Studio mix player">
      <div className="vz-player-info"><span>STUDIO MIX</span><strong title={name}>{name}</strong></div>
      <button onClick={() => getEngine().seek(0)} aria-label="Restart song"><SkipBack size={16} /></button>
      <button className="vz-player-play" onClick={toggle} aria-label={playing ? 'Pause song' : 'Play song'}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <div className="vz-player-seek">
        <input aria-label="Song position" type="range" min={0} max={duration} step={.05} value={Math.min(duration, Math.max(0, position))} onChange={(e) => getEngine().seek(Number(e.target.value))} />
        <span>{formatTime(Math.max(0, position), false)} / {formatTime(duration, false)}</span>
      </div>
      <label className="vz-player-volume"><Volume2 size={16} /><input aria-label="Song volume" type="range" min={0} max={1} step={.01} value={Math.min(1, volume)} onChange={(e) => useStore.getState().mutate('Master volume', (p) => { p.master.volume = Number(e.target.value) }, { coalesce: 'master-vol' })} /></label>
    </section>
  )
}
