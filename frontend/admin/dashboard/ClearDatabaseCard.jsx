import { useState } from 'preact/hooks';
import { postJson } from '../../shared/csrf.js';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.jsx';
import { Message } from '../../shared/ui/Message.jsx';

export function ClearDatabaseCard({ csrfToken, raffleStatus, voteStatus, onCleared }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const disabled = raffleStatus === 'open' || voteStatus === 'open';

  async function handleClear() {
    setBusy(true);
    const res = await postJson('/admin/api/system/clear', csrfToken, { password });
    setBusy(false);
    setConfirm(false);
    if (!res.ok || !res.data.ok) {
      return setResult({ kind: 'error', text: res.data?.message ?? 'Could not clear the data. Please try again.' });
    }
    setPassword('');
    setResult({ kind: 'success', text: 'Everything has been cleared. You can start setting up the next event.' });
    onCleared?.();
  }

  return (
    <details className="danger-zone">
      <summary>Start a brand-new event (erases everything)</summary>
      <div className="danger-body">
        <p>
          This erases all employees, raffle entries, prizes and winners, and voting finalists and votes, so you can
          begin a completely fresh event. Admin accounts and the activity log are kept. It can't be undone.
          {disabled && ' Close the raffle and voting first — this is unavailable while either one is open.'}
        </p>
        <label htmlFor="clearPassword">Type your admin password to confirm</label>
        <input
          id="clearPassword"
          type="password"
          autoComplete="current-password"
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
          disabled={disabled}
        />
        <div className="actions">
          <button type="button" className="btn-danger" onClick={() => setConfirm(true)} disabled={disabled || !password}>
            Erase everything
          </button>
        </div>
        <Message text={result?.text} kind={result?.kind} />
      </div>
      <ConfirmDialog
        open={confirm}
        danger
        title="Erase everything?"
        confirmLabel="Yes, erase everything"
        busy={busy}
        onConfirm={handleClear}
        onCancel={() => setConfirm(false)}
      >
        <p>
          All employees, raffle data and voting data will be permanently erased. This can't be undone.
        </p>
      </ConfirmDialog>
    </details>
  );
}
