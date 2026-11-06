import { AnimatePresence, motion } from 'motion/react'
import { useToasts } from '../core/toast'

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast toast-${t.kind ?? 'info'}`}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            onClick={() => useToasts.getState().dismiss(t.id)}
          >
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-body">{t.body}</div>}
            {t.action && (
              <button
                className="toast-action"
                onClick={(e) => {
                  e.stopPropagation()
                  t.action!.run()
                  useToasts.getState().dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
