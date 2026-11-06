// Helpers to read / edit an effect chain (a track's or the master's) with undo.

import { defaultParams, getEffect } from '../../core/effects/registry.js'
import { uid } from '../../core/ids.js'
import { useStore } from '../../core/store.js'

export const EMPTY                   = []

export function chainOf(p                          , target        ) {
  return target === 'master' ? p.master.effects : p.tracks.find((t) => t.id === target)?.effects
}

export function useChain(target        )                   {
  return useStore((s) => chainOf(s.project, target) ?? EMPTY)
}

export function editChain(target        , label        , fn                                          , coalesce         ) {
  useStore.getState().mutate(
    label,
    (p) => {
      const c = chainOf(p, target)
      if (c) fn(c                           )
    },
    coalesce ? { coalesce } : undefined,
  )
}

export function addEffect(target        , type        , preset                )                {
  const def = getEffect(type)
  if (!def) return null
  const id = uid('fx')
  const params = { ...defaultParams(type), ...(preset ? def.presets?.[preset] : {}) }
  editChain(target, `Add ${def.name}`, (c) => {
    c.push({ id, type, params, bypass: false })
  })
  return id
}

let session = 0
/** Coalesce key for a knob drag. Call `endDrag()` on commit so the next drag is a new undo step. */
export const dragKey = (id        , key        ) => `fx:${id}:${key}:${session}`
export const endDrag = () => void session++

export function setParams(target        , id        , patch                        , coalesceKey         ) {
  const type = chainOf(useStore.getState().project, target)?.find((e) => e.id === id)?.type ?? ''
  const def = getEffect(type)
  editChain(
    target,
    `Adjust ${def?.name ?? 'effect'}`,
    (c) => {
      const e = c.find((x) => x.id === id)
      if (e) Object.assign(e.params, patch)
    },
    coalesceKey,
  )
}

/** Which named preset (if any) matches the current params. */
export function matchingPreset(type        , params                        )                {
  const def = getEffect(type)
  for (const [name, pr] of Object.entries(def?.presets ?? {})) {
    if (Object.entries(pr).every(([k, v]) => Math.abs((params[k] ?? NaN) - v) < 1e-6)) return name
  }
  return null
}
