// Importing this registers every real-time effect.
import './tone.js'
import './dynamics.js'
import './space.js'
import './modulation.js'
import './creative.js'
import { fxMeta } from './shared.js'

// the core's built-in 3-band EQ gets an icon too
if (!fxMeta.has('eq3')) fxMeta.set('eq3', { icon: 'eq', tags: 'eq tone bass treble simple' })

export { fxMeta }
