import { Button, Modal } from '../../ui/kit'
import { ioSet, useIO } from './state'

export function ConfirmDialog() {
  const c = useIO((s) => s.confirm)
  const done = (ok: boolean) => {
    c?.resolve(ok)
    ioSet({ confirm: null })
  }
  return (
    <Modal
      open={!!c}
      onClose={() => done(false)}
      width={420}
      title={c?.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => done(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => done(true)}>
            {c?.confirmLabel ?? 'Continue'}
          </Button>
        </>
      }
    >
      <p className="io-muted" style={{ margin: 0, lineHeight: 1.5 }}>
        {c?.body}
      </p>
    </Modal>
  )
}
