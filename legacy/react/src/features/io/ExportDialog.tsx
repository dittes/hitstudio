// The big, friendly export modal.
import { Download, Eye, Lock, Pause, Sparkles, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getEngine } from '../../core/engine'
import { formatTime } from '../../core/ids'
import { projectDuration, useStore } from '../../core/store'
import { toast } from '../../core/toast'
import { Button, Hint, Modal, Segmented, burst } from '../../ui/kit'
import { FORMAT_INFO, estimateBytes, formatBytes, opusMode } from './export/encode'
import { LOUDNESS_TARGET, type LoudnessPreset } from './export/loudness'
import {
  DEFAULT_SETTINGS,
  clearExportCache,
  effectiveRate,
  formatOptions,
  rangeFor,
  renderPolishedCached,
  runExport,
  stemTracks,
  type ExportOutput,
  type ExportSettings,
  type Target,
} from './export/pipeline'
import type { FormatId } from './export/types'
import { download, ioSet, useIO } from './state'

const LS = 'bloom.export.v1'
function loadSettings(): ExportSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(LS) || '{}'), title: '', artist: '' }
  } catch {
    return DEFAULT_SETTINGS
  }
}
function saveSettings(s: ExportSettings) {
  localStorage.setItem(LS, JSON.stringify({ ...s, title: '' }))
}

const LOUDNESS_OPTS: { value: LoudnessPreset; label: string; blurb: string }[] = [
  { value: 'off', label: 'Off', blurb: 'Leave the volume exactly as mixed.' },
  { value: 'streaming', label: 'Streaming', blurb: 'Matches Spotify, YouTube & Apple Music (−14 LUFS) so they won’t turn you down.' },
  { value: 'podcast', label: 'Podcast', blurb: 'Comfortable speech level (−16 LUFS) used by most podcast apps.' },
  { value: 'loud', label: 'Loud', blurb: 'Big and punchy (−9 LUFS) for club-style tracks. A limiter keeps it clean.' },
]

function Ring({ value, label }: { value: number; label: string }) {
  const R = 52
  const C = 2 * Math.PI * R
  return (
    <div className="io-ring">
      <svg viewBox="0 0 120 120" width="150" height="150">
        <circle cx="60" cy="60" r={R} className="io-ring-bg" />
        <motion.circle
          cx="60"
          cy="60"
          r={R}
          className="io-ring-fg"
          stroke="url(#io-ring-grad)"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - Math.max(0.02, Math.min(1, value))) }}
          transition={{ type: 'spring', stiffness: 120, damping: 24 }}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="io-ring-center">
        <b>{Math.round(value * 100)}%</b>
        <span>{label}</span>
      </div>
    </div>
  )
}

export function ExportDialog() {
  const open = useIO((s) => s.exportOpen)
  const preset = useIO((s) => s.exportPreset)
  const project = useStore((s) => s.project)
  const selection = useStore((s) => s.selection.range)
  const hints = useStore((s) => s.ui.hints)
  const [s, setS] = useState<ExportSettings>(loadSettings)
  const [stage, setStage] = useState<'options' | 'working' | 'done'>('options')
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ExportOutput | null>(null)
  const ctl = useRef({ cancelled: false })
  const [prev, setPrev] = useState<'idle' | 'rendering' | 'playing'>('idle')
  const stopPreview = useRef<(() => void) | null>(null)

  const set = (p: Partial<ExportSettings>) =>
    setS((x) => {
      const n = { ...x, ...p }
      saveSettings(n)
      return n
    })

  // reset every time the dialog opens
  useEffect(() => {
    if (!open) {
      stopPreview.current?.()
      return
    }
    setStage('options')
    setError('')
    setResult(null)
    setProgress(0)
    const st = useStore.getState()
    const hasSel = !!st.selection.range && st.selection.range.end - st.selection.range.start > 0.05
    setS((x) => {
      let target: Target = preset?.target ?? (hasSel ? 'selection' : 'song')
      if (target === 'selection' && !hasSel) target = 'song'
      const n: ExportSettings = {
        ...x,
        target,
        format: preset?.format ?? x.format,
        mp3Kbps: preset?.format === 'mp3' && preset.kbps ? preset.kbps : x.mp3Kbps,
        title: st.project.name,
      }
      return n
    })
    clearExportCache()
    ioSet({ exportPreset: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const range = useMemo(() => rangeFor(s.target === 'stems' ? 'song' : s.target), [s.target, project, selection])
  const dur = range ? range.end - range.start : 0
  const stems = useMemo(() => stemTracks(), [project])
  const hasSel = !!selection && selection.end - selection.start > 0.05
  const songDur = projectDuration(project)
  const fmt = opusMode()
  const rate = effectiveRate(s)
  const bytes = estimateBytes(formatOptions(s), dur, rate, s.channels) * (s.target === 'stems' ? Math.max(1, stems.length) : 1)

  const targets: { id: Target; label: string; sub: string; ok: boolean }[] = [
    { id: 'song', label: 'Whole song', sub: songDur > 0 ? formatTime(songDur, false) : 'empty', ok: songDur > 0 },
    { id: 'selection', label: 'Selection', sub: hasSel ? formatTime(selection!.end - selection!.start, false) : 'select a range first', ok: hasSel },
    {
      id: 'loop',
      label: 'Loop region',
      sub: project.loop.end - project.loop.start > 0.05 ? `${formatTime(project.loop.start, false)} → ${formatTime(project.loop.end, false)}` : 'not set',
      ok: project.loop.end - project.loop.start > 0.05,
    },
    { id: 'stems', label: 'Each track', sub: stems.length ? `${stems.length} file${stems.length > 1 ? 's' : ''} in a zip` : 'no tracks yet', ok: stems.length > 0 },
  ]

  const close = () => {
    if (stage === 'working') return
    stopPreview.current?.()
    ioSet({ exportOpen: false })
  }

  async function doPreview() {
    if (prev === 'playing') return stopPreview.current?.()
    if (prev === 'rendering' || !range) return
    setPrev('rendering')
    try {
      getEngine().pause()
      const { pcm } = await renderPolishedCached(range, s)
      const eng = getEngine()
      await eng.resume()
      const b = eng.ctx.createBuffer(pcm.channels.length, pcm.channels[0].length, pcm.sampleRate)
      pcm.channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i))
      const src = eng.ctx.createBufferSource()
      src.buffer = b
      src.connect(eng.ctx.destination)
      const done = () => {
        try { src.stop() } catch {}
        src.disconnect()
        stopPreview.current = null
        setPrev('idle')
      }
      src.onended = done
      stopPreview.current = done
      src.start()
      setPrev('playing')
    } catch (e) {
      console.error(e)
      setPrev('idle')
      toast({ title: 'Couldn’t make a preview', body: String((e as Error).message ?? e), kind: 'error' })
    }
  }

  async function doExport(e?: React.MouseEvent) {
    stopPreview.current?.()
    ctl.current = { cancelled: false }
    setStage('working')
    setProgress(0)
    setError('')
    setPhase('Getting ready…')
    const t0 = performance.now()
    try {
      const out = await runExport(s, {
        get cancelled() {
          return ctl.current.cancelled
        },
        onProgress: (p) => setProgress(p),
        onPhase: setPhase,
      })
      // let people see the ring finish
      setProgress(1)
      await new Promise((r) => setTimeout(r, Math.max(250, 700 - (performance.now() - t0))))
      setResult(out)
      download(out.blob, out.filename)
      setStage('done')
      const x = e?.clientX ?? window.innerWidth / 2
      const y = e?.clientY ?? window.innerHeight / 2
      burst(x, y)
      toast({ title: 'Export complete! 🎉', body: `${out.filename} · ${formatBytes(out.blob.size)}`, kind: 'celebrate', ms: 4500 })
    } catch (err) {
      const msg = (err as Error).message
      if (msg === 'cancelled') {
        setStage('options')
        return
      }
      console.error(err)
      setError(msg || 'Something went wrong while exporting.')
      setStage('options')
    }
  }

  const info = FORMAT_INFO.find((f) => f.id === s.format)!
  const canExport = s.target === 'stems' ? stems.length > 0 : !!range

  return (
    <Modal
      open={open}
      onClose={close}
      width={760}
      title={
        <span className="io-title-row">
          <Download size={18} /> Export your song
        </span>
      }
      footer={
        stage === 'options' ? (
          <>
            <span className="io-foot-info">
              {canExport ? (
                <>
                  <b>{info.label}</b> · about <b>{formatBytes(bytes)}</b> · {formatTime(dur, false)}
                </>
              ) : (
                'Add some audio to export'
              )}
            </span>
            <Button
              variant="outline"
              icon={prev === 'playing' ? <Pause /> : prev === 'rendering' ? <Sparkles className="io-spin" /> : <Eye />}
              onClick={doPreview}
              disabled={!canExport || s.target === 'stems'}
              title={s.target === 'stems' ? 'Preview plays the full mix – pick “Whole song” to hear it' : 'Listen to exactly what will be exported'}
            >
              {prev === 'playing' ? 'Stop preview' : prev === 'rendering' ? 'Mixing…' : 'Preview'}
            </Button>
            <Button variant="primary" size="lg" icon={<Download />} disabled={!canExport} onClick={doExport}>
              Export {info.label}
            </Button>
          </>
        ) : stage === 'working' ? (
          <Button variant="ghost" icon={<X />} onClick={() => (ctl.current.cancelled = true)}>
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStage('options')}>
              Change settings
            </Button>
            <Button variant="soft" icon={<Download />} onClick={() => result && download(result.blob, result.filename)}>
              Download again
            </Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </>
        )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {stage === 'options' && (
          <motion.div key="opts" className="io-ex" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
            <p className="io-privacy">
              <Lock size={12} /> Runs in your browser. Nothing is uploaded.
            </p>
            {error && (
              <div className="io-callout io-callout-bad">
                <b>Export didn’t work</b>
                <span>{error}</span>
              </div>
            )}

            <section className="io-sec">
              <h3>
                <i>1</i> What do you want to export?
              </h3>
              <div className="io-targets">
                {targets.map((t) => (
                  <motion.button
                    key={t.id}
                    className={`io-target ${s.target === t.id ? 'on' : ''}`}
                    disabled={!t.ok}
                    whileHover={t.ok ? { y: -2 } : undefined}
                    whileTap={t.ok ? { scale: 0.96 } : undefined}
                    onClick={() => set({ target: t.id })}
                  >
                    {s.target === t.id && <motion.span layoutId="io-target-pill" className="io-pill" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
                    <b>{t.label}</b>
                    <small>{t.sub}</small>
                  </motion.button>
                ))}
              </div>
            </section>

            <section className="io-sec">
              <h3>
                <i>2</i> Pick a format
              </h3>
              <div className="io-formats">
                {FORMAT_INFO.map((f, i) => {
                  const off = f.id === 'opus' && fmt === 'none'
                  return (
                    <motion.button
                      key={f.id}
                      className={`io-format ${s.format === f.id ? 'on' : ''}`}
                      disabled={off}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: off ? 0.4 : 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      whileHover={off ? undefined : { y: -4, rotate: -0.6 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => set({ format: f.id as FormatId })}
                    >
                      {s.format === f.id && <motion.span layoutId="io-format-ring" className="io-format-ring" transition={{ type: 'spring', stiffness: 500, damping: 34 }} />}
                      <span className="io-format-emoji">{f.emoji}</span>
                      <b>{f.label}</b>
                      <small>{off ? 'Not supported here' : f.blurb}</small>
                    </motion.button>
                  )
                })}
              </div>
              <div className="io-row">
                {s.format === 'wav' && (
                  <Opt label="Quality">
                    <Segmented value={String(s.wavBits)} onChange={(v) => set({ wavBits: +v as 16 | 24 | 32 })} options={[{ value: '16', label: '16-bit (CD)' }, { value: '24', label: '24-bit' }, { value: '32', label: '32-bit float' }]} />
                  </Opt>
                )}
                {s.format === 'flac' && (
                  <Opt label="Quality">
                    <Segmented value={String(s.flacBits)} onChange={(v) => set({ flacBits: +v as 16 | 24 })} options={[{ value: '16', label: '16-bit (CD)' }, { value: '24', label: '24-bit' }]} />
                  </Opt>
                )}
                {s.format === 'aiff' && (
                  <Opt label="Quality">
                    <Segmented value={String(s.aiffBits)} onChange={(v) => set({ aiffBits: +v as 16 | 24 })} options={[{ value: '16', label: '16-bit (CD)' }, { value: '24', label: '24-bit' }]} />
                  </Opt>
                )}
                {s.format === 'mp3' && (
                  <Opt label="Quality">
                    <Segmented value={String(s.mp3Kbps)} onChange={(v) => set({ mp3Kbps: +v })} options={[{ value: '128', label: '128 kbps', title: 'Smallest' }, { value: '192', label: '192 kbps' }, { value: '256', label: '256 kbps' }, { value: '320', label: '320 kbps', title: 'Best' }]} />
                  </Opt>
                )}
                {s.format === 'opus' && (
                  <Opt label="Quality">
                    <Segmented value={String(s.opusKbps)} onChange={(v) => set({ opusKbps: +v })} options={[{ value: '64', label: '64 kbps' }, { value: '96', label: '96 kbps' }, { value: '128', label: '128 kbps' }, { value: '192', label: '192 kbps' }]} />
                  </Opt>
                )}
                <Opt label="Sample rate">
                  {s.format === 'opus' ? (
                    <span className="io-muted">48 kHz (required by Opus)</span>
                  ) : (
                    <Segmented value={String(s.sampleRate)} onChange={(v) => set({ sampleRate: +v as 44100 | 48000 })} options={[{ value: '44100', label: '44.1 kHz' }, { value: '48000', label: '48 kHz' }]} />
                  )}
                </Opt>
                <Opt label="Channels">
                  <Segmented value={String(s.channels)} onChange={(v) => set({ channels: +v as 1 | 2 })} options={[{ value: '2', label: 'Stereo' }, { value: '1', label: 'Mono' }]} />
                </Opt>
              </div>
              {s.format === 'opus' && fmt === 'realtime' && (
                <div className="io-callout">
                  <b>Heads up:</b> this browser can only make Opus in real time, so exporting takes as long as the song itself (the file will be .webm).
                </div>
              )}
            </section>

            <section className="io-sec">
              <h3>
                <i>3</i> Polish <small>(optional)</small>
              </h3>
              <div className="io-row">
                <Opt label="Loudness">
                  <Segmented
                    value={s.target === 'stems' ? 'off' : s.loudness}
                    onChange={(v) => set({ loudness: v })}
                    options={LOUDNESS_OPTS.map((o) => ({ value: o.value, label: o.label, title: o.blurb }))}
                  />
                </Opt>
                <Opt label="Fade out the end">
                  <Segmented value={String(s.fade)} onChange={(v) => set({ fade: +v })} options={[{ value: '0', label: 'No' }, { value: '1', label: '1 s' }, { value: '3', label: '3 s' }, { value: '5', label: '5 s' }]} />
                </Opt>
              </div>
              <AnimatePresence initial={false} mode="wait">
                <motion.p key={s.target === 'stems' ? 'stem' : s.loudness} className="io-loud-note" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {s.target === 'stems'
                    ? 'Each track is saved on its own, without effects from the master channel – ideal for mixing elsewhere. Loudness matching is skipped so the balance stays intact.'
                    : LOUDNESS_OPTS.find((o) => o.value === s.loudness)!.blurb}
                  {s.target !== 'stems' && LOUDNESS_TARGET[s.loudness] !== null && ' Peaks are kept under −1 dB.'}
                </motion.p>
              </AnimatePresence>
              <div className="io-meta">
                <label className="io-field">
                  <span>Title</span>
                  <input className="io-input" value={s.title} placeholder="My song" onChange={(e) => set({ title: e.target.value })} />
                </label>
                <label className="io-field">
                  <span>Artist</span>
                  <input className="io-input" value={s.artist} placeholder="You" onChange={(e) => set({ artist: e.target.value })} />
                </label>
              </div>
              {hints && <Hint>Title and artist are saved inside the file, so music players can show them.</Hint>}
            </section>
          </motion.div>
        )}

        {stage === 'working' && (
          <motion.div key="work" className="io-working" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <Ring value={progress} label="" />
            <h3>{phase}</h3>
            <p className="io-muted">Everything happens on your device – this can take a moment for long songs.</p>
            <div className="io-bar">
              <motion.div className="io-bar-fill" animate={{ width: `${Math.max(2, progress * 100)}%` }} transition={{ type: 'spring', stiffness: 160, damping: 26 }} />
            </div>
          </motion.div>
        )}

        {stage === 'done' && result && (
          <motion.div key="done" className="io-working io-done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 22 }}>
            <div className="io-check">
              <svg viewBox="0 0 52 52" width="92" height="92">
                <motion.circle cx="26" cy="26" r="23" fill="none" stroke="url(#io-ring-grad)" strokeWidth="3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6 }} />
                <motion.path d="M15 27l8 8 14-16" fill="none" stroke="var(--ok)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.35, duration: 0.4 }} />
              </svg>
            </div>
            <h3>Saved! 🎉</h3>
            <p className="io-file">{result.filename}</p>
            <p className="io-muted">
              {formatBytes(result.blob.size)}
              {result.note ? ` · ${result.note}` : ''}
              {result.gainDb !== 0 && ` · volume ${result.gainDb > 0 ? 'raised' : 'lowered'} by ${Math.abs(result.gainDb).toFixed(1)} dB to match the loudness preset`}
            </p>
            <p className="io-muted">Check your Downloads folder. If nothing appeared, press “Download again”.</p>
          </motion.div>
        )}
      </AnimatePresence>
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="io-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a78bfa" />
            <stop offset="0.55" stopColor="#f472b6" />
            <stop offset="1" stopColor="#fb923c" />
          </linearGradient>
        </defs>
      </svg>
    </Modal>
  )
}

function Opt({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="io-opt">
      <span className="io-opt-label">{label}</span>
      {children}
    </div>
  )
}

