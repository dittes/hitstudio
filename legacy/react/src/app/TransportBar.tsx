import { Circle, Pause, Play, Repeat, SkipBack, Square, Timer } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { runCommand } from '../core/commands'
import { getEngine } from '../core/engine'
import { formatTime } from '../core/ids'
import { useStore } from '../core/store'
import { IconButton, Meter, Slider, Tooltip } from '../ui/kit'

function Clock() {
  const ref = useRef<HTMLSpanElement>(null)
  const bpm = useStore((s) => s.project.bpm)
  const sig = useStore((s) => s.project.timeSig[0])
  const barRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const t = getEngine().position
      if (ref.current) ref.current.textContent = formatTime(t)
      if (barRef.current) {
        const beats = (t * bpm) / 60
        barRef.current.textContent = `${Math.floor(beats / sig) + 1}.${(Math.floor(beats) % sig) + 1}`
      }
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [bpm, sig])
  return (
    <div className="clock">
      <span ref={ref} className="clock-time mono">0:00.000</span>
      <span className="clock-bar mono">
        bar <span ref={barRef}>1.1</span>
      </span>
    </div>
  )
}

export function TransportBar() {
  const playing = useStore((s) => s.transport.playing)
  const recording = useStore((s) => s.transport.recording)
  const metronome = useStore((s) => s.transport.metronome)
  const loop = useStore((s) => s.project.loop.enabled)
  const bpm = useStore((s) => s.project.bpm)
  const vol = useStore((s) => s.project.master.volume)
  return (
    <footer className="transport">
      <div className="transport-left">
        <IconButton label="Go to start" shortcut="Home" icon={<SkipBack />} onClick={() => runCommand('transport.home')} />
        <Tooltip label={playing ? 'Pause' : 'Play'} shortcut="Space" side="top">
          <motion.button className={`play-btn ${playing ? 'on' : ''}`} whileTap={{ scale: 0.88 }} whileHover={{ scale: 1.06 }} onClick={() => runCommand('transport.toggle')}>
            <motion.span key={playing ? 'p' : 's'} initial={{ scale: 0.3, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }} style={{ display: 'inline-flex' }}>
              {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
            </motion.span>
          </motion.button>
        </Tooltip>
        <IconButton label="Stop" shortcut="Escape" icon={<Square />} onClick={() => runCommand('transport.stop')} />
        <Tooltip label={recording ? 'Stop recording' : 'Record'} shortcut="R" side="top">
          <motion.button className={`rec-btn ${recording ? 'on' : ''}`} whileTap={{ scale: 0.88 }} onClick={() => runCommand('transport.record')}>
            <Circle fill="currentColor" />
          </motion.button>
        </Tooltip>
        <Clock />
      </div>
      <div className="transport-mid">
        <IconButton label="Loop" shortcut="L" active={loop} icon={<Repeat />} onClick={() => runCommand('transport.loop')} />
        <IconButton label="Metronome" shortcut="M" active={metronome} icon={<Timer />} onClick={() => runCommand('transport.metronome')} />
        <label className="bpm">
          <input
            type="number"
            min={30}
            max={300}
            value={bpm}
            onChange={(e) => {
              const v = Math.max(30, Math.min(300, +e.target.value || 120))
              useStore.getState().mutate('Change tempo', (p) => void (p.bpm = v), { coalesce: 'bpm' })
            }}
          />
          <span>BPM</span>
        </label>
      </div>
      <div className="transport-right">
        <span className="faint" style={{ fontSize: 11 }}>Master</span>
        <Slider
          value={vol}
          min={0}
          max={1.5}
          defaultValue={1}
          length={110}
          onChange={(v) => useStore.getState().mutate('Master volume', (p) => void (p.master.volume = v), { coalesce: 'master-vol' })}
        />
        <MasterMeters />
      </div>
    </footer>
  )
}

function MasterMeters() {
  const an = getEngine().masterAnalyser
  return <Meter analyser={an} vertical={false} length={120} thickness={8} />
}
