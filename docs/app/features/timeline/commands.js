// Timeline commands (shortcuts + palette). Ids are prefixed `timeline.`.
import { allCommands, registerCommands, runCommand } from '../../core/commands.js'
import { getEngine } from '../../core/engine.js'
import { TRACK_COLORS, uid } from '../../core/ids.js'
import { toast } from '../../core/toast.js'

import {
  duplicateClips,
  getClipboard,
  pasteClipboard,
  removeClips,
  removeRange,
  setClipboard,
  cropClip,
  silenceRange,
  splitClipAt,
  trimToRange,
} from './ops.js'
import { clipLen, gridStep, S, setScroll, viewSeconds, zoomAround, zoomToFit } from './state.js'

const inEdit = () => S().ui.mode === 'edit'
const hasClips = () => inEdit() && S().project.clips.length > 0
const hasRange = () => {
  const { range, trackIds } = S().selection
  return !!range && range.end - range.start > 0.001 && trackIds.length > 0
}
const hasSelection = () => inEdit() && (S().selection.clipIds.length > 0 || hasRange())

export function selectedClips()         {
  const ids = new Set(S().selection.clipIds)
  return S().project.clips.filter((c) => ids.has(c.id))
}

/** First track the user is "on": selected track, else the track of the first selected clip, else track 0. */
export function focusTrackIndex()         {
  const { project, selection } = S()
  const id = selection.trackIds[0] ?? selectedClips()[0]?.trackId
  const i = project.tracks.findIndex((t) => t.id === id)
  return i < 0 ? 0 : i
}

export function processAvailable(id        ) {
  return allCommands().some((c) => c.id === id)
}

/** Run a process.* command (registered by the effects feature) on a clip. */
export function runProcessOn(clipId           , cmd        ) {
  if (!processAvailable(cmd)) {
    toast({ title: 'That effect is still loading', kind: 'info' })
    return
  }
  if (clipId) {
    const c = S().project.clips.find((x) => x.id === clipId)
    if (c) S().select({ clipIds: [clipId], trackIds: [c.trackId], range: null })
  }
  runCommand(cmd)
}

// ── actions ─────────────────────────────────────────────────
export function splitAtPlayhead() {
  const t = getEngine().position
  const { selection, project } = S()
  const under = (c      ) => c.start < t && c.start + clipLen(c) > t
  let targets = selectedClips().filter(under)
  if (!targets.length) {
    const tracks = selection.trackIds.length ? new Set(selection.trackIds) : null
    targets = project.clips.filter((c) => under(c) && (!tracks || tracks.has(c.trackId)))
  }
  if (!targets.length) {
    toast({ title: 'Nothing to split here', body: 'Move the playhead over a clip first.' })
    return
  }
  const created       = []
  S().mutate('Split clip', (p) => {
    for (const c of targets) {
      const r = splitClipAt(p, c.id, t)
      if (r) created.push(r)
    }
  })
  if (created.length) S().select({ clipIds: created })
}

export function splitClipAtTime(clipId    , t        ) {
  let created            = null
  S().mutate('Split clip', (p) => {
    created = splitClipAt(p, clipId, t)
  })
  return created
}

export function deleteSelection() {
  const { selection } = S()
  if (selection.clipIds.length) {
    const ids = selection.clipIds
    S().mutate(ids.length > 1 ? 'Delete clips' : 'Delete clip', (p) => removeClips(p, ids))
    S().select({ clipIds: [] })
    return
  }
  if (hasRange()) {
    const { range, trackIds } = selection
    S().mutate('Delete selection', (p) => removeRange(p, trackIds, range .start, range .end))
    S().select({ range: null })
  }
}

export function copySelection(silent = false) {
  const { selection, project } = S()
  const order = project.tracks.map((t) => t.id)
  let clips = selectedClips()
  if (!clips.length && hasRange()) {
    const { range, trackIds } = selection
    const tracks = new Set(trackIds)
    clips = project.clips
      .filter((c) => tracks.has(c.trackId))
      .map((c) => cropClip(c, range .start, range .end))
      .filter((c)            => !!c)
  }
  if (!clips.length) {
    if (!silent) toast('Select a clip or drag over a region first')
    return false
  }
  setClipboard(clips, order)
  if (!silent) toast({ title: clips.length > 1 ? `Copied ${clips.length} clips` : 'Copied', ms: 1100 })
  return true
}

export function cutSelection() {
  if (!copySelection(true)) {
    toast('Select a clip or drag over a region first')
    return
  }
  deleteSelection()
  toast({ title: 'Cut – paste with ⌘V', ms: 1300 })
}

export function paste() {
  if (!getClipboard().length) {
    toast('Nothing copied yet')
    return
  }
  const at = getEngine().position
  const ti = focusTrackIndex()
  let ids       = []
  S().mutate('Paste', (p) => {
    ids = pasteClipboard(p, at, ti)
  })
  S().select({ clipIds: ids, range: null })
}

export function duplicateSelection(ids = S().selection.clipIds) {
  if (!ids.length) {
    toast('Select a clip to duplicate')
    return
  }
  let out       = []
  S().mutate('Duplicate clip', (p) => {
    out = duplicateClips(p, ids)
  })
  S().select({ clipIds: out })
}

export function selectAll() {
  const p = S().project
  S().select({ clipIds: p.clips.map((c) => c.id), trackIds: p.tracks.map((t) => t.id), range: null })
}

export function nudge(dir        ) {
  const ids = new Set(S().selection.clipIds)
  if (!ids.size) return
  const step = gridStep()
  S().mutate(
    'Nudge clip',
    (p) => {
      for (const c of p.clips) if (ids.has(c.id)) c.start = Math.max(0, c.start + dir * step)
    },
    { coalesce: `nudge-${[...ids].join()}` },
  )
}

export function addMarker(time = getEngine().position) {
  S().mutate('Add marker', (p) => {
    p.markers.push({ id: uid('mrk'), time, label: `Marker ${p.markers.length + 1}`, color: TRACK_COLORS[p.markers.length % TRACK_COLORS.length] })
    p.markers.sort((a, b) => a.time - b.time)
  })
}

export function setTool(tool      ) {
  S().setUI({ tool })
}

function rangeCommand(label        , fn                    ) {
  return () => {
    if (!hasRange()) {
      toast('Drag over a region of a track first')
      return
    }
    const { range, trackIds } = S().selection
    S().mutate(label, (p) => fn(p, trackIds, range .start, range .end))
    S().select({ clipIds: [] })
  }
}

// ── registration ────────────────────────────────────────────
let registered = false
export function registerTimelineCommands() {
  if (registered) return
  registered = true
  const G = 'Edit'
  registerCommands([
    { id: 'timeline.split', label: 'Split at playhead', group: G, shortcut: 'S', enabled: hasClips, run: splitAtPlayhead, keywords: 'cut razor divide' },
    { id: 'timeline.delete', label: 'Delete selection', group: G, shortcut: 'Delete', enabled: hasSelection, run: deleteSelection, keywords: 'remove erase' },
    { id: 'timeline.copy', label: 'Copy', group: G, shortcut: 'Mod+C', enabled: hasSelection, run: () => copySelection() },
    { id: 'timeline.cut', label: 'Cut', group: G, shortcut: 'Mod+X', enabled: hasSelection, run: cutSelection },
    { id: 'timeline.paste', label: 'Paste at playhead', group: G, shortcut: 'Mod+V', enabled: inEdit, run: paste },
    { id: 'timeline.duplicate', label: 'Duplicate clip', group: G, shortcut: 'Mod+D', enabled: () => inEdit() && S().selection.clipIds.length > 0, run: () => duplicateSelection() },
    { id: 'timeline.selectAll', label: 'Select all clips', group: G, shortcut: 'Mod+A', enabled: inEdit, run: selectAll },
    {
      id: 'timeline.deselect',
      label: 'Select nothing',
      group: G,
      shortcut: 'Shift+Mod+A',
      enabled: inEdit,
      run: () => S().select({ clipIds: [], range: null }),
    },
    { id: 'timeline.trim', label: 'Trim to selection (keep only the selected part)', group: G, enabled: () => inEdit() && hasRange(), run: rangeCommand('Trim to selection', trimToRange), keywords: 'crop keep' },
    { id: 'timeline.silence', label: 'Silence selection', group: G, enabled: () => inEdit() && hasRange(), run: rangeCommand('Silence selection', silenceRange), keywords: 'mute quiet' },
    { id: 'timeline.nudgeLeft', label: 'Nudge clip left', group: G, shortcut: 'Alt+ArrowLeft', enabled: () => inEdit() && S().selection.clipIds.length > 0, run: () => nudge(-1) },
    { id: 'timeline.nudgeRight', label: 'Nudge clip right', group: G, shortcut: 'Alt+ArrowRight', enabled: () => inEdit() && S().selection.clipIds.length > 0, run: () => nudge(1) },
    { id: 'timeline.marker', label: 'Add marker at playhead', group: G, shortcut: 'Shift+M', enabled: inEdit, run: () => addMarker(), keywords: 'flag cue' },
    { id: 'timeline.zoomIn', label: 'Zoom in', group: 'View', shortcut: ['=', 'Shift+=', '+', 'Shift++'], enabled: inEdit, run: () => zoomAround(S().ui.zoom * 1.5) },
    { id: 'timeline.zoomOut', label: 'Zoom out', group: 'View', shortcut: ['-', 'Shift+_'], enabled: inEdit, run: () => zoomAround(S().ui.zoom / 1.5) },
    { id: 'timeline.zoomFit', label: 'Zoom to fit the whole song', group: 'View', shortcut: 'Shift+Z', enabled: inEdit, run: zoomToFit },
    {
      id: 'timeline.zoomSelection',
      label: 'Zoom to selection',
      group: 'View',
      enabled: () => inEdit() && (hasRange() || S().selection.clipIds.length > 0),
      run: () => {
        const r = S().selection.range
        let a        , b
        if (r && r.end > r.start) [a, b] = [r.start, r.end]
        else {
          const cs = selectedClips()
          if (!cs.length) return
          a = Math.min(...cs.map((c) => c.start))
          b = Math.max(...cs.map((c) => c.start + clipLen(c)))
        }
        const span = Math.max(0.05, b - a)
        const zoom = Math.min(2000, Math.max(5, (viewSeconds(1) * 0.9) / span))
        S().setUI({ zoom })
        setScroll(a - span * 0.05)
      },
    },
    { id: 'timeline.toolSelect', label: 'Select tool', group: 'Tools', shortcut: '1', enabled: inEdit, run: () => setTool('select') },
    { id: 'timeline.toolCut', label: 'Cut tool (scissors)', group: 'Tools', shortcut: '2', enabled: inEdit, run: () => setTool('cut'), keywords: 'razor split' },
    { id: 'timeline.snap', label: 'Toggle snap to grid', group: 'View', enabled: inEdit, run: () => S().setUI({ snap: !S().ui.snap }), keywords: 'magnet grid' },
    {
      id: 'timeline.inspector',
      label: 'Toggle clip inspector',
      group: 'View',
      shortcut: 'I',
      enabled: inEdit,
      run: () => S().setUI({ panel: S().ui.panel === 'inspector' ? null : 'inspector' }),
      keywords: 'panel effects properties',
    },
  ])
}

