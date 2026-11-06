// Shown when the project has no tracks: a friendly, animated starting point.
import { Drum, Mic, Sparkles, Upload } from 'lucide-react'
import { motion } from 'motion/react'
import { runCommand } from '../../core/commands'
import { useStore } from '../../core/store'
import { Button } from '../../ui/kit'

const BARS = 48

function FloatingWave() {
  return (
    <div className="tl-empty-wave" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => {
        const h = 18 + Math.round(Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21)) * 62)
        return <span key={i} style={{ height: `${h}%`, animationDelay: `${-(i * 0.07).toFixed(2)}s` }} />
      })}
    </div>
  )
}

const STEPS = [
  { n: 1, t: 'Add sound', d: 'Drop a file, record or load the demo' },
  { n: 2, t: 'Arrange', d: 'Drag clips, cut with S, trim the edges' },
  { n: 3, t: 'Share', d: 'Export as MP3 or WAV when you’re happy' },
]

export function EmptyState() {
  const hints = useStore((s) => s.ui.hints)
  return (
    <motion.div className="tl-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }}>
      <motion.div
        className="tl-empty-card"
        initial={{ y: 24, scale: 0.96, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.05 }}
      >
        <div className="tl-empty-orb" aria-hidden />
        <FloatingWave />
        <h1 className="tl-empty-title">
          Drop audio here, <span className="grad-text">record your voice</span> or try a demo
        </h1>
        <p className="tl-empty-sub muted">MP3, WAV, FLAC, OGG, M4A or even a video file. Nothing is uploaded – it all stays on your computer.</p>
        <div className="tl-empty-actions">
          <Button variant="primary" size="lg" icon={<Upload />} onClick={() => runCommand('io.import')}>
            Open a file
          </Button>
          <Button variant="soft" size="lg" icon={<Mic />} onClick={() => runCommand('transport.record')}>
            Record
          </Button>
          <Button variant="soft" size="lg" icon={<Sparkles />} onClick={() => runCommand('io.demo')}>
            Try a demo
          </Button>
          <Button variant="outline" size="lg" icon={<Drum />} onClick={() => useStore.getState().setMode('create')}>
            Make a beat
          </Button>
        </div>
        {hints && (
          <div className="tl-empty-steps">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.n}
                className="tl-empty-step"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.09, type: 'spring', stiffness: 400, damping: 28 }}
              >
                <span className="tl-empty-step-n">{s.n}</span>
                <div>
                  <div className="tl-empty-step-t">{s.t}</div>
                  <div className="tl-empty-step-d faint">{s.d}</div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
