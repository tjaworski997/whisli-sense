import { useEffect, useRef } from "react"

import { Button } from "@/components/button"

/** Confirmation dialog (native <dialog>). */
export function MessageBox({ open, title, message, confirmLabel, cancelLabel, danger = false, busy = false, error, onConfirm, onClose }: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  busy?: boolean
  error?: string
  onConfirm: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
  }, [open])

  return <dialog ref={dialog} className="whisli-dialog" onClose={onClose}>
    <h2 className="text-base font-semibold">{title}</h2>
    <p className="whisli-muted mt-2">{message}</p>
    {error && <p role="alert" className="whisli-status-error mt-3 text-xs">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>{cancelLabel}</Button>
      <Button variant={danger ? "danger" : "default"} disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
    </div>
  </dialog>
}
