import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { getEngine } from './core/engine'
import './styles/global.css'
// feature modules that register effects / commands on import
import './features/effects'
import './features/io'

// The AudioContext starts suspended until the first user gesture; resume on any click/key.
getEngine()
const unlock = () => getEngine().resume()
window.addEventListener('pointerdown', unlock, { capture: true })
window.addEventListener('keydown', unlock, { capture: true })

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
