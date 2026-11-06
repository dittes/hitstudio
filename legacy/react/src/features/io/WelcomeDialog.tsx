// "Welcome to HitStudio" – the friendly start screen.
import { Bell, FileAudio, Disc3, Drum, Gauge, History, Merge, Mic, Scissors, Sparkles, Upload, Wind, Activity, Headphones, VolumeX } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { runCommand } from '../../core/commands'
import { useStore } from '../../core/store'
import { toast } from '../../core/toast'
import { Button, Modal, Toggle } from '../../ui/kit'
import { getAutosaveInfo, restoreAutosave, type AutosaveInfo } from './autosave'
import { importFiles } from './import'
import { QUICK_TASKS, quickTask, type QuickTask } from './quicktasks'
import { ioSet, pickFiles, useIO } from './state'

import { playWelcomeSound } from './welcome-sound'

export const WELCOME_KEY = 'bloom.welcome.dismissed'

const TASK_ICON: Record<QuickTask, React.ReactNode> = {
  cut: <Scissors />,
  join: <Merge />,
  ringtone: <Bell />,
  noise: <Wind />,
  speed: <Gauge />,
  convert: <FileAudio />,
  bpm: <Activity />,
}

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

export function WelcomeDialog() {
  const open = useIO((s) => s.welcomeOpen)
  const [auto, setAuto] = useState<AutosaveInfo | null>(null)
  const [never, setNever] = useState(() => localStorage.getItem(WELCOME_KEY) === '1')
  useEffect(() => {
    if (open) getAutosaveInfo().then(setAuto)
  }, [open])
  const close = () => ioSet({ welcomeOpen: false })
  const go = (fn: () => void) => () => {
    close()
    fn()
  }

  const enter = (sound: boolean) => {
    if (sound) void playWelcomeSound().catch(() => toast('Sound could not start. You can still explore the studio.'))
    try { sessionStorage.setItem('hitstudio.enterImmersive', '1') } catch { /* browser storage may be unavailable */ }
    useStore.getState().setMode('visualize')
    window.dispatchEvent(new Event('hitstudio:immerse'))
    close()
  }

  const cards: { id: string; icon: React.ReactNode; title: string; sub: string; hue: string; run: () => void; hidden?: boolean }[] = [
    {
      id: 'continue',
      icon: <History />,
      title: 'Continue where you left off',
      sub: auto ? `“${auto.name}” · ${auto.tracks} tracks · saved ${ago(auto.savedAt)}` : '',
      hue: 'var(--accent-3)',
      hidden: !auto,
      run: go(async () => {
        const ok = await restoreAutosave()
        toast(ok ? { title: 'Welcome back! 🌸', body: 'Your last session is restored.', kind: 'success' } : { title: 'Couldn’t restore that session', kind: 'error' })
      }),
    },
    { id: 'record', icon: <Mic />, title: 'Record your voice', sub: 'Talk, sing or play – straight from your microphone.', hue: '#f87171', run: go(() => runCommand('transport.record')) },
    {
      id: 'import',
      icon: <Upload />,
      title: 'Import audio',
      sub: 'Drop in songs, voice memos or even video files.',
      hue: 'var(--accent)',
      run: () => {
        close()
        void pickFiles().then((f) => { if (f.length) void importFiles(f) })
      },
    },
    { id: 'beat', icon: <Drum />, title: 'Make a beat', sub: 'Tap out drums and melodies with the step sequencer.', hue: '#fb923c', run: go(() => useStore.getState().setMode('create')) },
    { id: 'dj', icon: <Disc3 />, title: 'DJ two songs', sub: 'Two decks, a crossfader and automatic tempo matching.', hue: 'var(--accent-2)', run: go(() => useStore.getState().setMode('dj')) },
    { id: 'demo', icon: <Sparkles />, title: 'Try the demo song', sub: 'A ready-made 4-track song to play with.', hue: '#4ade80', run: go(() => runCommand('io.demo')) },
  ]

  return (
    <Modal open={open} onClose={close} width={940}>
      <div className="io-welcome">
        <div className="io-blobs" aria-hidden>
          <span className="io-blob b1" />
          <span className="io-blob b2" />
          <span className="io-blob b3" />
        </div>
        <motion.div className="io-hero" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
          <div className="io-logo">
            <span />
            <span />
            <span />
            <span />
          </div>
          <h1>Welcome to HitStudio</h1>
          <span className="io-domain">hitstudio.org</span>
          <p className="io-promise">Make music. Feel it.</p>
          <p>Your space to create, mix and get lost in sound.</p>
          <p className="io-tagline">Runs in your browser. Nothing is uploaded.</p>
        </motion.div>

        <div className="io-entry">
          <Button variant="primary" size="lg" icon={<Headphones />} onClick={() => enter(true)}>Enter with sound</Button>
          <Button variant="ghost" icon={<VolumeX />} onClick={() => enter(false)}>Enter quietly</Button>
          <span>A short welcome chime, then your music takes over.</span>
        </div>

        <div className="io-cards">
          {cards
            .filter((c) => !c.hidden)
            .map((c, i) => (
              <motion.button
                key={c.id}
                className={`io-card ${c.id === 'continue' ? 'io-card-wide' : ''}`}
                style={{ ['--hue' as string]: c.hue }}
                initial={{ opacity: 0, y: 18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.08 + i * 0.05, type: 'spring', stiffness: 320, damping: 24 }}
                whileHover={{ y: -5 }}
                whileTap={{ scale: 0.97 }}
                onClick={c.run}
              >
                <span className="io-card-icon">{c.icon}</span>
                <b>{c.title}</b>
                <small>{c.sub}</small>
              </motion.button>
            ))}
        </div>

        <div className="io-tasks">
          <h4>Quick tasks</h4>
          <div className="io-task-row">
            {QUICK_TASKS.map((t, i) => (
              <motion.button
                key={t.id}
                className="io-task"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35 + i * 0.03 }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.95 }}
                title={t.sub}
                onClick={() => {
                  close()
                  void quickTask(t.id)
                }}
              >
                <span className="io-task-icon">{TASK_ICON[t.id]}</span>
                {t.label}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="io-welcome-foot">
          <Toggle
            on={never}
            onChange={(v) => {
              setNever(v)
              localStorage.setItem(WELCOME_KEY, v ? '1' : '0')
            }}
            label="Don’t show this when I start"
          />
          <button className="io-link" onClick={close}>
            Start with an empty project →
          </button>
        </div>
      </div>
    </Modal>
  )
}
