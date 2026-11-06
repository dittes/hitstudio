import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { RollingNumber } from '../../ui/kit'
import { fmtDb, parseDb } from './faderLaw'
import { EffectRack } from '../effects'

export const Rack = EffectRack as unknown as React.FC<{ target: string; compact?: boolean }>

/** Volume as dB: rolling number display, click to type an exact value. */
export function DbField({ gain, onSet }: { gain: number; onSet: (g: number) => void }) {
  const [edit, setEdit] = useState(false)
  const [txt, setTxt] = useState('')
  const inp = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (edit) inp.current?.select()
  }, [edit])
  const done = (apply: boolean) => {
    if (apply) {
      const g = parseDb(txt)
      if (g !== null) onSet(g)
    }
    setEdit(false)
  }
  if (edit)
    return (
      <input
        ref={inp}
        className="mx-db-input mono"
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') done(true)
          if (e.key === 'Escape') done(false)
          e.stopPropagation()
        }}
        aria-label="Volume in dB"
      />
    )
  return (
    <button
      className="mx-db mono"
      title="Volume in dB. Click to type a value."
      onClick={() => {
        setTxt(fmtDb(gain).replace('+', ''))
        setEdit(true)
      }}
    >
      <RollingNumber value={fmtDb(gain)} />
      <span className="mx-db-unit">dB</span>
    </button>
  )
}

/** Mute / Solo / Arm toggle with pop animation. */
export function ToggleBtn({
  on,
  onClick,
  children,
  kind,
  title,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  kind: 'mute' | 'solo' | 'arm'
  title: string
}) {
  return (
    <motion.button
      key={String(on)}
      className={`mx-tb mx-tb-${kind} ${on ? 'is-on' : ''}`}
      title={title}
      aria-pressed={on}
      onClick={onClick}
      initial={{ scale: on ? 0.7 : 1.12 }}
      animate={{ scale: 1 }}
      whileTap={{ scale: 0.86 }}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 700, damping: 18 }}
    >
      {children}
    </motion.button>
  )
}
