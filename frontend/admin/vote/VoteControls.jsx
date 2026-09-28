import { useState } from 'preact/hooks';
import { postJson } from '../../shared/csrf.js';

export function DurationStartForm({ csrfToken, durationMinutes: initialDuration, onChanged }) {
  const [durationMinutes, setDurationMinutes] = useState(initialDuration);
  const [result, setResult] = useState(null);

  async function handleSaveDuration(e) {
    e.preventDefault();
    const { data } = await postJson('/admin/api/vote/config', csrfToken, { durationMinutes: Number(durationMinutes) });
    setResult(data);
    if (data.ok) onChanged?.();
  }

  async function handleStart(e) {
    e.preventDefault();
    const { data } = await postJson('/admin/api/vote/start', csrfToken, {});
    setResult(data);
    if (data.ok) onChanged?.();
  }

  async function handleClose(e) {
    e.preventDefault();
    const { data } = await postJson('/admin/api/vote/close', csrfToken, {});
    setResult(data);
    if (data.ok) onChanged?.();
  }

  return (
    <div className="card">
      <h2>2. Duration &amp; start</h2>
      <form onSubmit={handleSaveDuration}>
        <label htmlFor="durationMinutes">Duration (minutes)</label>
        <input
          id="durationMinutes"
          type="number"
          min="1"
          value={durationMinutes}
          onInput={(e) => setDurationMinutes(e.currentTarget.value)}
        />
        <button type="submit">Save duration</button>
      </form>
      <form onSubmit={handleStart}>
        <button type="submit">Start voting</button>
      </form>
      <form onSubmit={handleClose}>
        <button type="submit" className="btn-secondary">Close now</button>
      </form>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}

export function ResetCard({ csrfToken, status, onReset }) {
  const [password, setPassword] = useState('');
  const [wipeFinalists, setWipeFinalists] = useState(false);
  const [result, setResult] = useState(null);

  const disabled = status === 'open';

  async function handleReset(e) {
    e.preventDefault();
    const confirmed = window.confirm(
      wipeFinalists
        ? 'This wipes ALL votes AND the finalist list. This cannot be undone. Continue?'
        : 'This wipes all votes (finalist list is kept). This cannot be undone. Continue?'
    );
    if (!confirmed) return;

    const { data } = await postJson('/admin/api/vote/reset', csrfToken, { password, wipeFinalists });
    setResult(data);
    if (data.ok) {
      setPassword('');
      onReset?.();
    }
  }

  return (
    <div className="card">
      <h2>Reset &amp; reopen fresh</h2>
      <p>
        Wipes cast votes so voting can be started again from scratch. Close voting first — this is disabled
        while it's open. Requires your own admin password to confirm.
      </p>
      <form onSubmit={handleReset}>
        <label htmlFor="resetPassword">Your admin password</label>
        <input
          id="resetPassword"
          type="password"
          autoComplete="current-password"
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
          disabled={disabled}
        />
        <label>
          <input
            type="checkbox"
            checked={wipeFinalists}
            onInput={(e) => setWipeFinalists(e.currentTarget.checked)}
            disabled={disabled}
          />
          {' '}Also wipe the finalist list (you'll need to reconfigure it)
        </label>
        <button type="submit" className="btn-danger" disabled={disabled || !password}>
          Reset voting
        </button>
      </form>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
