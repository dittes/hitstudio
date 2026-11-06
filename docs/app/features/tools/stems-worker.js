// Runs the stem separation off the main thread so the page stays responsive.
import { separateStems } from './stems-core.js'

let cancelled = false
self.onmessage = async (e) => {
  const m = e.data
  if (m.type === 'cancel') {
    cancelled = true
    return
  }
  if (m.type !== 'start') return
  cancelled = false
  try {
    const stems = await separateStems(m.left, m.right, m.sampleRate, {
      onProgress: (p) => self.postMessage({ type: 'progress', p }),
      shouldCancel: () => cancelled,
    })
    if (!stems) {
      self.postMessage({ type: 'cancelled' })
      return
    }
    const transfer = []
    for (const k of Object.keys(stems)) transfer.push(stems[k][0].buffer, stems[k][1].buffer)
    self.postMessage({ type: 'done', stems }, transfer)
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error?.message || error) })
  }
}
