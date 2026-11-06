// OWNER: effects agent.
// Importing this module:
//   • registers all real-time insert effects (defs/*) in core/effects/registry
//   • registers the destructive `process.*` commands (processes.ts)
//   • process dialogs self-mount into document.body on first use (ProcessDialogs.tsx)
// Exports EffectRack({ target, compact? }) — target = trackId or 'master'.
import './defs'
import './processes'

export { EffectRack } from './EffectRack'
export { ProcessDialogs, mountProcessDialogs } from './ProcessDialogs'
export { openProcess, runProcess, PROCESSES } from './processes'
