// Renders the controls of one effect: segmented choices, switches and knobs.
import { AnimatePresence, motion } from 'motion/react'
import type { EffectDef, EffectParamDef } from '../../../core/effects/registry'
import { Knob, Segmented, Toggle } from '../../../ui/kit'
import { fxMeta } from '../defs/shared'

export interface ParamControlsProps {
  def: EffectDef
  params: Record<string, number>
  onChange: (key: string, v: number) => void
  onCommit?: () => void
  color?: string
  /** only render these keys (in this order) */
  only?: string[]
  /** never render these keys */
  skip?: string[]
  knobSize?: number
}

export function visibleParams(def: EffectDef, params: Record<string, number>, only?: string[], skip?: string[]) {
  const meta = fxMeta.get(def.type) ?? {}
  let list = def.params
  if (only) list = only.map((k) => def.params.find((p) => p.key === k)).filter(Boolean) as EffectParamDef[]
  return list.filter((p) => !skip?.includes(p.key) && (meta.showIf?.[p.key]?.(params) ?? true))
}

export function ParamControls({ def, params, onChange, onCommit, color, only, skip, knobSize = 46 }: ParamControlsProps) {
  const meta = fxMeta.get(def.type) ?? {}
  const list = visibleParams(def, params, only, skip)
  const enums = list.filter((p) => meta.enums?.[p.key])
  const toggles = list.filter((p) => meta.toggles?.includes(p.key))
  const knobs = list.filter((p) => !meta.enums?.[p.key] && !meta.toggles?.includes(p.key))
  const val = (p: EffectParamDef) => params[p.key] ?? p.default
  return (
    <div className="fx-params">
      {(enums.length > 0 || toggles.length > 0) && (
        <div className="fx-param-row">
          {enums.map((p) => (
            <div key={p.key} className="fx-enum" title={p.hint}>
              <span className="fx-enum-label">{p.label}</span>
              <Segmented
                size="sm"
                value={String(Math.round(val(p)))}
                options={meta.enums![p.key].map((label, i) => ({ value: String(i), label }))}
                onChange={(v) => {
                  onChange(p.key, Number(v))
                  onCommit?.()
                }}
              />
            </div>
          ))}
          {toggles.map((p) => (
            <div key={p.key} className="fx-toggle" title={p.hint}>
              <Toggle
                on={val(p) >= 0.5}
                label={p.label}
                onChange={(on) => {
                  onChange(p.key, on ? 1 : 0)
                  onCommit?.()
                }}
              />
            </div>
          ))}
        </div>
      )}
      <div className="fx-knobs">
        <AnimatePresence initial={false} mode="popLayout">
          {knobs.map((p) => (
            <motion.div
              key={p.key}
              layout
              className="fx-knob"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              title={p.hint}
            >
              <Knob
                value={val(p)}
                min={p.min}
                max={p.max}
                step={p.step}
                unit={p.unit}
                curve={p.curve}
                label={p.label}
                defaultValue={p.default}
                bipolar={p.min < 0 && p.max > 0}
                color={color}
                size={knobSize}
                hint={p.hint}
                onChange={(v) => onChange(p.key, v)}
                onCommit={onCommit}
              />
              <span className="fx-knob-val mono">{fmt(val(p), p)}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function fmt(v: number, p: Pick<EffectParamDef, 'unit' | 'step'>) {
  const step = p.step ?? 0.01
  if (p.unit === 'Hz' && v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz`
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  const s = v.toFixed(dec)
  if (!p.unit) return s
  if (p.unit === '%') return `${s}%`
  return `${s} ${p.unit}`
}
