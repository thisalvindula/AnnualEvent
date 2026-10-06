import { useEffect, useRef } from 'preact/hooks';

// Plain-language "are you sure?" box (replaces window.confirm on admin
// screens). Controlled: render it with `open` and handle both callbacks.
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Yes, continue',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      onCancel={(e) => {
        e.preventDefault(); // Esc: let the parent decide
        onCancel?.();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel?.(); // click on the backdrop
      }}
    >
      <h2>{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button type="button" className={danger ? 'btn-danger' : ''} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
