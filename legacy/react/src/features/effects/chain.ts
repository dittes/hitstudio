// Helpers to read / edit an effect chain (a track's or the master's) with undo.
import type { Draft } from 'immer'
import { defaultParams, getEffect } from '../../core/effects/registry'
import { uid } from '../../core/ids'
import { useStore } from '../../core/store'
import type { EffectInstance, Project } from '../../core/types'

export const EMPTY: EffectInstance[] = []

export function chainOf(p: Project | Draft<Project>, target: string) {
  return target === 'master' ? p.master.effects : p.tracks.find((t) => t.id === target)?.effects
}

export function useChain(target: string): EffectInstance[] {
  return useStore((s) => chainOf(s.project, target) ?? EMPTY) as EffectInstance[]
}

export function editChain(target: string, label: string, fn: (chain: Draft<EffectInstance>[]) => void, coalesce?: string) {
  useStore.getState().mutate(
    label,
    (p) => {
      const c = chainOf(p, target)
      if (c) fn(c as Draft<EffectInstance>[])
    },
    coalesce ? { coalesce } : undefined,
  )
}

export function addEffect(target: string, type: string, preset?: string | null): string | null {
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
export const dragKey = (id: string, key: string) => `fx:${id}:${key}:${session}`
export const endDrag = () => void session++

export function setParams(target: string, id: string, patch: Record<string, number>, coalesceKey?: string) {
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
export function matchingPreset(type: string, params: Record<string, number>): string | null {
  const def = getEffect(type)
  for (const [name, pr] of Object.entries(def?.presets ?? {})) {
    if (Object.entries(pr).every(([k, v]) => Math.abs((params[k] ?? NaN) - v) < 1e-6)) return name
  }
  return null
}
