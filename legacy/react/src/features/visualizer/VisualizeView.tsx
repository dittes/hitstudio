import { AnimatePresence, motion } from 'motion/react'
import { AudioWaveform, Building2, CircleDot, Disc3, Maximize2, Minimize2, Mountain, Play, Sparkles, Video, Expand, Shrink, FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getEngine } from '../../core/engine'
import { useStore } from '../../core/store'
import { toast } from '../../core/toast'
import { formatTime } from '../../core/ids'
import { Button, IconButton, Kbd, Slider, Toggle, Tooltip } from '../../ui/kit'
import { ImmersivePlayer } from './ImmersivePlayer'
import { sampleAnalysis } from './analysis'
import { startCanvasVisualizer } from './renderer2d'
import { startWebGLVisualizer } from './renderer3d'
import { importFiles } from '../io/import'
import { ioSet, pickFiles } from '../io/state'
import { downloadBlob, startVideoRecording, videoExtension, type VideoRecorder } from './recorder'
import { createBars } from './scenes/bars'
import { createOrb } from './scenes/orb'
import { createParticles } from './scenes/particles'
import { createRibbon } from './scenes/ribbon'
import { createTerrain } from './scenes/terrain'
import { createTunnel } from './scenes/tunnel'
import { PALETTES } from './scenes/types'
import './visualizer.css'

const SCENES = [
  { id: 'terrain', name: 'Terrain', Icon: Mountain, make: createTerrain },
  { id: 'orb', name: 'Orb', Icon: CircleDot, make: createOrb },
  { id: 'tunnel', name: 'Tunnel', Icon: Disc3, make: createTunnel },
  { id: 'particles', name: 'Galaxy', Icon: Sparkles, make: createParticles },
  { id: 'ribbon', name: 'Ribbon', Icon: AudioWaveform, make: createRibbon },
  { id: 'bars', name: 'Bars city', Icon: Building2, make: createBars },
] as const

const LS = 'bloom.viz.'
const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(LS + k)
    return v === null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const save = (k: string, v: unknown) => {
  try { localStorage.setItem(LS + k, JSON.stringify(v)) } catch {}
}

interface Live {
  want: number
  palette: string
  sens: number
  auto: boolean
}

export function VisualizeView() {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fadeRef = useRef<HTMLDivElement>(null)
  const [scene, setScene] = useState<number>(() => Math.min(SCENES.length - 1, Math.max(0, Math.trunc(Number(load('scene', 0))) || 0)))
  const [palette, setPalette] = useState<string>(() => (PALETTES[load('palette', 'bloom')] ? load('palette', 'bloom') : 'bloom'))
  const [sens, setSens] = useState<number>(() => Math.max(0.4, Math.min(2.5, Number(load('sens', 1)) || 1)))
  const [auto, setAuto] = useState<boolean>(() => load('auto', false))
  const [uiShown, setUiShown] = useState(true)
  const [full, setFull] = useState(false)
  const [theater, setTheater] = useState(() => {
    try { return sessionStorage.getItem('hitstudio.enterImmersive') === '1' } catch { return false }
  })
  const immersive = full || theater
  const [silent, setSilent] = useState(true)
  const [rendererMode, setRendererMode] = useState<'webgl' | 'canvas'>(() => load<string>('renderer', 'webgl') === 'canvas' ? 'canvas' : 'webgl')
  const [recSecs, setRecSecs] = useState<number | null>(null)
  const recRef = useRef<{ r: VideoRecorder; t0: number; scene: string } | null>(null)
  const hideTimer = useRef(0)
  const recordBusy = useRef(false)
  const recordEpoch = useRef(0)
  const playing = useStore((s) => s.transport.playing)
  const hasClips = useStore((s) => s.project.clips.length > 0)

  const live = useRef<Live>({ want: scene, palette, sens, auto })
  live.current = { want: scene, palette, sens, auto }

  useEffect(() => save('renderer', rendererMode), [rendererMode])
  useEffect(() => save('scene', scene), [scene])
  useEffect(() => save('palette', palette), [palette])
  useEffect(() => save('sens', sens), [sens])
  useEffect(() => save('auto', auto), [auto])

  useEffect(() => {
    try { sessionStorage.removeItem('hitstudio.enterImmersive') } catch { /* optional entry preference */ }
    const enter = () => { setTheater(true); setUiShown(true) }
    window.addEventListener('hitstudio:immerse', enter)
    return () => window.removeEventListener('hitstudio:immerse', enter)
  }, [])
  useEffect(() => {
    if (!theater) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setTheater(false)
        setUiShown(true)
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [theater])

  // Both renderers use the same master analysis and scene controls.
  useEffect(() => {
    const canvas = canvasRef.current!
    const root = rootRef.current!
    if (fadeRef.current) fadeRef.current.style.opacity = '0'
    if (rendererMode === 'canvas') return startCanvasVisualizer(canvas, root, () => live.current)
    return startWebGLVisualizer(canvas, root, SCENES, () => live.current, fadeRef.current, () => {
      const take = recRef.current
      recRef.current = null
      if (take) {
        setRecSecs(null)
        void take.r.stop().then((blob) => downloadBlob(blob, `hitstudio-visual-${take.scene}.${videoExtension(take.r.mime)}`))
          .catch(() => toast({ title: 'Recording interrupted by a graphics error', kind: 'error' }))
      }
      setRendererMode('canvas')
    })
  }, [rendererMode])

  useEffect(() => {
    let raf = 0
    let checked = 0
    let switched = performance.now()
    let drop = sampleAnalysis().dropCount
    const monitor = (now: number) => {
      raf = requestAnimationFrame(monitor)
      if (document.hidden || now - checked < 200) return
      checked = now
      const a = sampleAnalysis()
      setSilent(a.silent)
      if (live.current.auto && !a.silent && a.dropCount !== drop && now - switched > 9000) {
        switched = now
        setScene((i) => (i + 1) % SCENES.length)
      }
      drop = a.dropCount
    }
    raf = requestAnimationFrame(monitor)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => () => {
    recordEpoch.current++
    const rec = recRef.current
    recRef.current = null
    if (rec) void rec.r.stop().then((b) => downloadBlob(b, `hitstudio-visual-${rec.scene}.${videoExtension(rec.r.mime)}`)).catch(() => {})
  }, [])

  // ── auto-hide UI ───────────────────────────────────────────
  const poke = useCallback(() => {
    setUiShown(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) setUiShown(false)
    }, 3000)
  }, [])
  useEffect(() => {
    poke()
    return () => clearTimeout(hideTimer.current)
  }, [poke])

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else rootRef.current?.requestFullscreen?.().catch(() => toast('Fullscreen is not available here'))
  }

  // ── recording ──────────────────────────────────────────────
  useEffect(() => {
    if (recSecs === null) return
    const id = setInterval(() => {
      const r = recRef.current
      if (r) setRecSecs((performance.now() - r.t0) / 1000)
    }, 250)
    return () => clearInterval(id)
  }, [recSecs === null])

  const toggleRecord = async () => {
    if (recordBusy.current) return
    const cur = recRef.current
    if (cur) {
      recRef.current = null
      setRecSecs(null)
      try {
        const blob = await cur.r.stop()
        downloadBlob(blob, `hitstudio-visual-${cur.scene}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${videoExtension(cur.r.mime)}`)
        toast({ title: 'Video saved', body: 'Check your downloads folder.', kind: 'success' })
      } catch (error) { toast({ title: 'Could not save video', body: String(error), kind: 'error' }) }
      return
    }
    if (typeof MediaRecorder === 'undefined' || !canvasRef.current) {
      toast({ title: 'Recording is not supported in this browser', kind: 'error' })
      return
    }
    const canvas = canvasRef.current
    recordBusy.current = true
    const epoch = recordEpoch.current
    try {
      const r = await startVideoRecording(canvas)
      if (epoch !== recordEpoch.current || canvas !== canvasRef.current) { void r.stop().catch(() => {}); return }
      recRef.current = { r, t0: performance.now(), scene: SCENES[scene].id }
      setRecSecs(0)
      if (!useStore.getState().transport.playing && hasClips && silent) play()
    } catch (e) {
      toast({ title: 'Could not start recording', body: String(e), kind: 'error' })
    } finally { recordBusy.current = false }
  }

  const play = () => {
    void getEngine().play().catch(() => toast({ title: 'Could not start audio', kind: 'error' }))
  }

  const importAudio = async () => {
    const files = await pickFiles()
    if (!files.length) return
    const added = await importFiles(files)
    if (added.clipIds.length) play()
  }

  const showPlay = hasClips && !playing && silent
  const showEmpty = !hasClips && silent

  return (
    <div
      ref={rootRef}
      className={`vz-root ${theater ? 'vz-theater' : ''} ${immersive && !uiShown && !silent ? 'vz-idle' : ''}`}
      onFocusCapture={poke}
      onKeyDown={poke}
      onPointerMove={poke}
      onPointerDown={poke}
    >
      <canvas key={rendererMode} ref={canvasRef} className="vz-canvas" aria-label={`${SCENES[scene].name} audio visualization`} />
      <div ref={fadeRef} className="vz-fade" />

      <AnimatePresence>
        {showPlay && (
          <motion.div key="play" className="vz-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.button
              className="vz-bigplay"
              onClick={play}
              whileHover={{ scale: 1.07 }}
              whileTap={{ scale: 0.94 }}
              animate={{ boxShadow: ['0 0 0 0 rgba(167,139,250,.5)', '0 0 0 26px rgba(167,139,250,0)'] }}
              transition={{ boxShadow: { duration: 1.8, repeat: Infinity, ease: 'easeOut' } }}
              aria-label="Play"
            >
              <Play size={38} fill="currentColor" />
            </motion.button>
            <div className="vz-center-text">Press play to see your sound</div>
          </motion.div>
        )}
        {showEmpty && (
          <motion.div key="empty" className="vz-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="vz-center-text">Your sound, in full colour.</div>
            <div className="vz-sub">Open a song, choose a scene and settle in. Everything you hear shapes what you see.</div>
            <div className="vz-row" style={{ justifyContent: 'center', marginTop: 10, pointerEvents: 'auto' }}>
              <Button size="sm" onClick={() => useStore.getState().setMode('dj')}>Open DJ</Button>
              <Button size="sm" variant="primary" onClick={() => void importAudio()}>Open audio</Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* top bar */}
      <AnimatePresence>
        {(!immersive || uiShown || silent || recSecs !== null) && (
          <motion.div className="vz-top" initial={{ opacity: 0, y: -10 }} animate={{ opacity: uiShown ? 1 : 0.9, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="vz-chip">
              <button className="vz-wordmark" aria-label="HitStudio home" onClick={() => ioSet({ welcomeOpen: true })}>HitStudio</button>
              <span>{SCENES[scene].name}</span>
              <span className="vz-status">{silent ? 'Preview' : 'Live audio'}</span>
              <span className="vz-dim">·</span>
              <Kbd k="Space" /> <span className="vz-dim">play / pause</span>
            </div>
            <div className="vz-row">
              <AnimatePresence>
                {recSecs !== null && (
                  <motion.div className="vz-rec" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                    <span className="vz-rec-dot" /> REC {formatTime(recSecs, false)}
                  </motion.div>
                )}
              </AnimatePresence>
              {(!immersive || uiShown || silent) && (
                <>
                  <Button variant={recSecs !== null ? 'danger' : 'soft'} size="sm" icon={<Video size={15} />} onClick={toggleRecord}>
                    {recSecs !== null ? 'Stop & save' : 'Record video'}
                  </Button>
                  <IconButton label="Open audio" variant="soft" onClick={() => void importAudio()} icon={<FolderOpen />} />
                  <IconButton label={theater ? 'Back to studio' : 'Enter immersive view'} variant="soft" onClick={() => { setTheater(!theater); poke() }} icon={theater ? <Shrink /> : <Expand />} />
                  <IconButton label={full ? 'Exit fullscreen' : 'Fullscreen'} variant="soft" onClick={toggleFull} icon={full ? <Minimize2 /> : <Maximize2 />} />
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {immersive && <ImmersivePlayer />}

      {/* bottom controls */}
      <AnimatePresence>
        {(!immersive || uiShown || silent) && (
          <motion.div className="vz-bottom" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
            <div className="vz-cards">
              {SCENES.map((s, i) => (
                <motion.button
                  key={s.id}
                  className={`vz-card ${i === scene ? 'on' : ''}`}
                  onClick={() => setScene(i)}
                  aria-pressed={i === scene}
                  aria-label={`${s.name} scene`}
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                >
                  <div className={`vz-art vz-art-${s.id}`}>
                    {s.id === 'bars' && Array.from({ length: 7 }, (_, k) => <i key={k} style={{ animationDelay: `${k * 0.13}s` }} />)}
                    {s.id === 'terrain' && <b />}
                  </div>
                  <span className="vz-card-name"><s.Icon size={12} /> {s.name}</span>
                  {i === scene && <motion.span layoutId="vz-card-ring" className="vz-card-ring" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
                </motion.button>
              ))}
            </div>
            <div className="vz-renderer" role="status">
              <span>{rendererMode === 'canvas' ? 'Compatibility renderer · all six scenes available' : '3D renderer'}</span>
              <button disabled={recSecs !== null} onClick={() => setRendererMode(rendererMode === 'canvas' ? 'webgl' : 'canvas')}>
                {rendererMode === 'canvas' ? 'Try 3D' : 'Use compatibility mode'}
              </button>
            </div>
            <div className="vz-panel">
              <div className="vz-row">
                {Object.entries(PALETTES).map(([id, p]) => (
                  <Tooltip key={id} label={p.label} side="top">
                    <motion.button
                      className={`vz-pal ${palette === id ? 'on' : ''}`}
                      style={{ background: p.chip }}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => setPalette(id)}
                      aria-label={`${p.label} colors`}
                    />
                  </Tooltip>
                ))}
              </div>
              <div className="vz-sep" />
              <div className="vz-row vz-sens">
                <span className="vz-lbl">Sensitivity</span>
                <Slider value={sens} min={0.4} max={2.5} step={0.01} defaultValue={1} length={120} onChange={setSens} />
              </div>
              <div className="vz-sep" />
              <Toggle on={auto} onChange={setAuto} label="Switch scenes on drops" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
