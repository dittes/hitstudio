// Importing this registers every real-time effect.
import './tone'
import './dynamics'
import './space'
import './modulation'
import './creative'
import { fxMeta } from './shared'

// the core's built-in 3-band EQ gets an icon too
if (!fxMeta.has('eq3')) fxMeta.set('eq3', { icon: 'eq', tags: 'eq tone bass treble simple' })

export { fxMeta }
