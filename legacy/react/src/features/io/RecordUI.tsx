// "Recording setup" modal + the floating recording HUD.
import { Headphones, Mic, Square } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { getEngine } from '../../core/engine'
import { formatTime } from '../../core/ids'
import { Button, Hint, Meter, Modal, Segmented, Toggle } from '../../ui/kit'
import { micConstraints, micErrorMessage, startRecording, stopRecording, useRec, useRecSettings } from './record'
import { ioSet, useIO } from './state'

function useMicPreview(active: boolean) {
  const cfg = useRecSettings()
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [error, setError] = useState<{ title: string; body: string } | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    if (!active) return
    let stream: MediaStream | null = null
    let src: MediaStreamAudioSourceNode | null = null
    let dead = false
    setError(null)
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia(micConstraints(cfg))
        if (dead) return stream.getTracks().forEach((t) => t.stop())
        const ctx = getEngine().ctx
        src = ctx.createMediaStreamSource(stream)
        const an = ctx.createAnalyser()
        an.fftSize = 1024
        src.connect(an)
        setAnalyser(an)
        const list = await navigator.mediaDevices.enumerateDevices()
        if (!dead) setDevices(list.filter((d) => d.kind === 'audioinput'))
      } catch (e) {
        if (!dead) setError(micErrorMessage(e))
      }
    })()
    return () => {
      dead = true
      setAnalyser(null)
      try {
        src?.disconnect()
      } catch {}
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active, cfg.deviceId, cfg.clean, cfg.mode])
  return { analyser, error, devices }
}

export function RecordSetup() {
  const open = useIO((s) => s.recSetupOpen)
  const cfg = useRecSettings()
  const { analyser, error, devices } = useMicPreview(open)
  const close = () => ioSet({ recSetupOpen: false })
  return (
    <Modal
      open={open}
      onClose={close}
      width={520}
      title={
        <span className="io-title-row">
          <Mic size={18} /> Recording setup
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Not now
          </Button>
          <Button variant="primary" size="lg" icon={<Mic />} onClick={() => void startRecording()} disabled={!!error}>
            Start recording
          </Button>
        </>
      }
    >
      <div className="io-rec">
        <p className="io-muted">Say something – the bar should bounce. Your sound never leaves this device.</p>
        <div className="io-rec-meter">
          <Meter analyser={analyser} vertical={false} length={440} thickness={14} />
          {!analyser && !error && <span className="io-muted io-rec-wait">Waiting for your microphone…</span>}
        </div>
        {error && (
          <motion.div className="io-callout io-callout-bad" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <b>{error.title}</b>
            <span>{error.body}</span>
          </motion.div>
        )}
        <label className="io-field">
          <span>Microphone</span>
          <select className="io-select" value={cfg.deviceId} onChange={(e) => cfg.patch({ deviceId: e.target.value })}>
            <option value="">Default microphone</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <div className="io-field">
          <span>What are you recording?</span>
          <Segmented
            value={cfg.mode}
            onChange={(m) => cfg.patch({ mode: m })}
            options={[
              { value: 'voice', label: '🗣️ Voice (mono)', title: 'One channel – perfect for talking and singing' },
              { value: 'music', label: '🎸 Music (stereo)', title: 'Two channels – for keyboards, guitars with stereo mics…' },
            ]}
          />
        </div>
        <div className="io-switches">
          <div className="io-switch">
            <Toggle on={cfg.clean} onChange={(v) => cfg.patch({ clean: v })} label="Clean up my voice" />
            <small>Turns on your browser’s noise &amp; echo reduction. Off gives the purest sound.</small>
          </div>
          <div className="io-switch">
            <Toggle on={cfg.countIn} onChange={(v) => cfg.patch({ countIn: v })} label="1-bar count-in" />
            <small>A bar of clicks before recording starts, in your song’s tempo.</small>
          </div>
          <div className="io-switch">
            <Toggle on={cfg.monitor} onChange={(v) => cfg.patch({ monitor: v })} label="Hear myself while recording" />
            <small>
              <Headphones size={12} style={{ verticalAlign: -2 }} /> Use headphones, or you’ll get feedback squeal.
            </small>
          </div>
        </div>
        <Hint>Press R any time to start and stop. Existing tracks play along while you record.</Hint>
      </div>
    </Modal>
  )
}

export function RecordHUD() {
  const phase = useRec((s) => s.phase)
  const elapsed = useRec((s) => s.elapsed)
  const beat = useRec((s) => s.beat)
  const beats = useRec((s) => s.beats)
  const analyser = useRec((s) => s.analyser)
  return (
    <AnimatePresence>
      {phase !== 'idle' && (
        <motion.div
          className="io-hud"
          initial={{ opacity: 0, y: -24, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 460, damping: 30 }}
        >
          <span className={`io-hud-dot ${phase === 'recording' ? 'on' : ''}`} />
          {phase === 'starting' && <span className="io-hud-label">Waking up the mic…</span>}
          {phase === 'countin' && (
            <span className="io-hud-label">
              Get ready…{' '}
              <AnimatePresence mode="popLayout">
                <motion.b key={beat} className="io-hud-count" initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}>
                  {Math.max(1, beat)}
                </motion.b>
              </AnimatePresence>
              <span className="io-muted"> / {beats}</span>
            </span>
          )}
          {phase === 'recording' && (
            <>
              <span className="io-hud-label">Recording</span>
              <span className="io-hud-time mono">{formatTime(elapsed, false)}</span>
              <Meter analyser={analyser} vertical={false} length={120} thickness={8} />
            </>
          )}
          <Button variant="danger" size="sm" icon={<Square size={12} fill="currentColor" />} onClick={() => void stopRecording()}>
            Stop
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

