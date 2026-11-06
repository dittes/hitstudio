// Parameter dialogs for the destructive processes + a floating progress pill.
//
// MOUNTING: the IO feature owns the app's dialog layer, so this feature mounts
// its own tiny React root instead. `mountProcessDialogs()` lazily creates
// <div id="fx-process-root"> in document.body and renders <ProcessDialogs/> into
// it the first time a process dialog or job needs it (wired via setDialogMounter
// in index.tsx). `ProcessDialogs` is also exported in case a host wants to mount it.
import { AnimatePresence, motion } from 'motion/react'
import { Loader2, Play, Square, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { allEffects, defaultParams, getEffect } from '../../core/effects/registry'
import { getEngine } from '../../core/engine'
import { useStore } from '../../core/store'
import { Button, Hint, Modal, Segmented, Slider, Toggle, burst } from '../../ui/kit'
import { fxMeta } from './defs/shared'
import {
  collectTargets, getProcess, learnNoiseFromSelection, noiseState, renderPreview, runProcess,
  selectionLoudness, selectionPeakDb, useJob, useProcDialog, type ProcParam,
} from './processes'
import { CATEGORY_INFO, FxIcon } from './ui/icons'
import { ParamControls, fmt } from './ui/ParamControls'
import './effects.css'

let mounted = false
export function mountProcessDialogs() {
  if (mounted || typeof document === 'undefined') return
  mounted = true
  const el = document.createElement('div')
  el.id = 'fx-process-root'
  document.body.appendChild(el)
  createRoot(el).render(<ProcessDialogs />)
}

export function ProcessDialogs() {
  return (
    <>
      <ProcessModal />
      <JobPill />
    </>
  )
}

function ProcessModal() {
  const openId = useProcDialog((s) => s.open)
  const close = useCallback(() => useProcDialog.setState({ open: null }), [])
  const def = openId ? getProcess(openId) : undefined
  return (
    <Modal
      open={!!def}
      onClose={close}
      width={def?.custom ? 560 : 460}
      title={
        def && (
          <span className="fx-dlg-title">
            <span className="fx-dlg-icon"><FxIcon name={def.icon} size={16} /></span>
            {def.label}
          </span>
        )
      }
    >
      {def && <DialogBody key={def.id} id={def.id} onDone={close} />}
    </Modal>
  )
}

const lastParams = new Map<string, Record<string, number>>()
let lastFxType = 'reverb'

function DialogBody({ id, onDone }: { id: string; onDone: () => void }) {
  const def = getProcess(id)!
  const hints = useStore((s) => s.ui.hints)
  const [params, setParams] = useState<Record<string, number>>(() => {
    const d: Record<string, number> = {}
    def.params?.forEach((p) => (d[p.key] = p.default))
    return { ...d, ...lastParams.get(id) }
  })
  const [fxType, setFxType] = useState<string>(() => lastFxType)
  const [fxParams, setFxParams] = useState<Record<string, number>>(() => defaultParams(fxType))
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState<'loading' | 'playing' | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const timer = useRef(0)
  const learned = noiseState((s) => s.learned)
  const targets = useMemo(() => collectTargets(), [])
  const hasRange = targets.some((t) => t.splitLeft || t.splitRight) || !!useStore.getState().selection.range
  const info = useMemo(() => {
    if (id === 'amplify') {
      const pk = selectionPeakDb()
      return isFinite(pk) ? `Loudest peak right now: ${pk.toFixed(1)} dB · room to boost: ${(-pk).toFixed(1)} dB` : 'The selection is silent.'
    }
    if (id === 'loudness') {
      const l = selectionLoudness()
      return isFinite(l) ? `Measured loudness right now: ${l.toFixed(1)} LUFS` : 'Too quiet to measure.'
    }
    if (id === 'normalize') {
      const pk = selectionPeakDb()
      return isFinite(pk) ? `Loudest peak right now: ${pk.toFixed(1)} dB` : ''
    }
    return ''
  }, [id])

  const stopPreview = () => {
    stopRef.current?.()
    stopRef.current = null
    clearTimeout(timer.current)
    setPreviewing(null)
  }
  useEffect(() => () => stopPreview(), [])
  useEffect(() => {
    lastParams.set(id, params)
  }, [id, params])

  const extra = def.custom ? { type: fxType, params: fxParams } : undefined

  const preview = async () => {
    if (previewing) return stopPreview()
    setPreviewing('loading')
    try {
      const buf = await renderPreview(id, params, extra)
      if (!buf) return setPreviewing(null)
      stopRef.current = getEngine().preview(buf)
      setPreviewing('playing')
      timer.current = window.setTimeout(() => setPreviewing(null), buf.duration * 1000 + 100)
    } catch (e) {
      console.error(e)
      setPreviewing(null)
    }
  }

  const apply = async (e: React.MouseEvent) => {
    stopPreview()
    const x = e.clientX, y = e.clientY
    setBusy(true)
    onDone()
    const ok = await runProcess(id, params, extra)
    setBusy(false)
    if (ok) burst(x, y)
  }

  const set = (k: string, v: number) => setParams((p) => ({ ...p, [k]: v }))
  const visible = (def.params ?? []).filter((p) => !(p.hideWhenRange && hasRange) && !(p.key === 'useLearned' && !learned))

  return (
    <div className="fx-dlg">
      <p className="fx-dlg-desc muted">{def.description}</p>
      <div className="fx-dlg-target faint">
        {targets.length === 1 ? (hasRange ? 'Works on: the selected time range' : 'Works on: the selected clip') : `Works on: ${targets.length} clips`}
      </div>

      {def.presets && (
        <div className="fx-dlg-presets">
          {Object.entries(def.presets).map(([name, vals], i) => {
            const on = Object.entries(vals).every(([k, v]) => params[k] === v)
            return (
              <motion.button
                key={name}
                className={`fx-chip ${on ? 'is-on' : ''}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileTap={{ scale: 0.92 }}
                onClick={() => setParams((p) => ({ ...p, ...vals }))}
              >
                {name}
              </motion.button>
            )
          })}
        </div>
      )}

      {info && <div className="fx-dlg-info mono">{info}</div>}

      {id === 'noiseReduce' && (
        <div className="fx-dlg-noise">
          <div>
            <b>Step 1 (optional):</b> select a moment of <i>only noise</i> and capture it. Otherwise HitStudio finds the quietest moments by itself.
          </div>
          <Button
            size="sm"
            variant={learned ? 'outline' : 'soft'}
            icon={<Wand2 />}
            onClick={() => {
              if (learnNoiseFromSelection()) set('useLearned', 1)
            }}
          >
            {learned ? 'Learn again' : 'Learn noise from selection'}
          </Button>
        </div>
      )}

      {def.custom && <EffectPicker type={fxType} setType={(t) => { setFxType(t); setFxParams(defaultParams(t)); lastFxType = t }} params={fxParams} setParams={setFxParams} />}

      <div className="fx-dlg-params">
        {visible.map((p) => (
          <ProcControl key={p.key} p={p} value={params[p.key] ?? p.default} onChange={(v) => set(p.key, v)} />
        ))}
      </div>

      {hints && <Hint>Press Preview to hear the first seconds before you commit. You can always undo with ⌘Z.</Hint>}

      <div className="fx-dlg-foot">
        <Button
          variant="outline"
          icon={previewing === 'loading' ? <Loader2 className="fx-spin" /> : previewing === 'playing' ? <Square /> : <Play />}
          onClick={preview}
        >
          {previewing === 'playing' ? 'Stop' : previewing === 'loading' ? 'Rendering…' : 'Preview'}
        </Button>
        <div style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={apply}>
          Apply
        </Button>
      </div>
    </div>
  )
}

function ProcControl({ p, value, onChange }: { p: ProcParam; value: number; onChange: (v: number) => void }) {
  if (p.toggle)
    return (
      <div className="fx-dlg-row" title={p.hint}>
        <Toggle on={value >= 0.5} onChange={(on) => onChange(on ? 1 : 0)} label={p.label} />
        {p.hint && <span className="fx-dlg-hint faint">{p.hint}</span>}
      </div>
    )
  if (p.options)
    return (
      <div className="fx-dlg-row">
        <span className="fx-dlg-label">{p.label}</span>
        <Segmented size="sm" value={String(Math.round(value))} options={p.options.map((label, i) => ({ value: String(i), label }))} onChange={(v) => onChange(Number(v))} />
      </div>
    )
  return (
    <div className="fx-dlg-slider" title={p.hint}>
      <div className="fx-dlg-slider-top">
        <span className="fx-dlg-label">{p.label}</span>
        <motion.span key={Math.round(value * 10)} className="fx-dlg-value mono" initial={{ scale: 1.12 }} animate={{ scale: 1 }}>
          {p.key === 'semitones' && value > 0 ? '+' : ''}
          {fmt(value, p)}
        </motion.span>
      </div>
      <Slider value={value} min={p.min} max={p.max} step={p.step} curve={p.curve} defaultValue={p.default} onChange={onChange} length={400} />
      {p.hint && <div className="fx-dlg-hint faint">{p.hint}</div>}
    </div>
  )
}

function EffectPicker({ type, setType, params, setParams }: { type: string; setType: (t: string) => void; params: Record<string, number>; setParams: (p: Record<string, number>) => void }) {
  const def = getEffect(type)
  const list = allEffects()
  return (
    <div className="fx-dlg-picker">
      <div className="fx-dlg-picker-grid">
        {list.map((d) => (
          <motion.button
            key={d.type}
            className={`fx-chip ${d.type === type ? 'is-on' : ''}`}
            style={{ ['--cat' as string]: CATEGORY_INFO[d.category]?.color }}
            whileTap={{ scale: 0.92 }}
            onClick={() => setType(d.type)}
          >
            <FxIcon name={fxMeta.get(d.type)?.icon} size={12} />
            {d.name}
          </motion.button>
        ))}
      </div>
      {def && (
        <motion.div key={type} className="fx-dlg-picker-params" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {def.presets && (
            <div className="fx-dlg-presets">
              {Object.keys(def.presets).map((n) => (
                <button key={n} className="fx-chip-sm" onClick={() => setParams({ ...params, ...def.presets![n] })}>
                  {n}
                </button>
              ))}
            </div>
          )}
          <ParamControls def={def} params={params} onChange={(k, v) => setParams({ ...params, [k]: v })} color={CATEGORY_INFO[def.category]?.color} knobSize={40} />
        </motion.div>
      )}
    </div>
  )
}

function JobPill() {
  const job = useJob()
  return (
    <AnimatePresence>
      {job.label && (
        <motion.div className="fx-job" initial={{ opacity: 0, y: 30, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.95 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
          <Loader2 size={15} className="fx-spin" />
          <span>{job.label}</span>
          <div className="fx-job-bar">
            <motion.div className="fx-job-fill" animate={{ width: `${Math.round(job.progress * 100)}%` }} transition={{ duration: 0.2 }} />
          </div>
          <span className="mono faint">{Math.round(job.progress * 100)}%</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
