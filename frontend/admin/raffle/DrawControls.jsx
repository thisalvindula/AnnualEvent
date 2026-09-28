import { useState } from 'preact/hooks';
import { postJson } from '../../shared/csrf.js';

export function OpenCloseForm({ csrfToken, onChanged }) {
  const [windowMinutes, setWindowMinutes] = useState(15);
  const [result, setResult] = useState(null);

  async function handleOpen(e) {
    e.preventDefault();
    const { data } = await postJson('/admin/api/raffle/open', csrfToken, { windowMinutes: Number(windowMinutes) });
    setResult(data);
    if (data.ok) onChanged?.();
  }

  async function handleClose(e) {
    e.preventDefault();
    const { data } = await postJson('/admin/api/raffle/close', csrfToken, {});
    setResult(data);
    if (data.ok) onChanged?.();
  }

  return (
    <div className="card">
      <h2>2. Open registration</h2>
      <form onSubmit={handleOpen}>
        <label htmlFor="windowMinutes">Window length (minutes)</label>
        <input
          id="windowMinutes"
          type="number"
          min="1"
          value={windowMinutes}
          onInput={(e) => setWindowMinutes(e.currentTarget.value)}
        />
        <button type="submit">Open</button>
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
  const [wipeGifts, setWipeGifts] = useState(false);
  const [result, setResult] = useState(null);

  const disabled = status === 'open';

  async function handleReset(e) {
    e.preventDefault();
    const confirmed = window.confirm(
      wipeGifts
        ? 'This wipes ALL entries, draw results, AND the gift list. This cannot be undone. Continue?'
        : 'This wipes all entries and draw results (gift list is kept). This cannot be undone. Continue?'
    );
    if (!confirmed) return;

    const { data } = await postJson('/admin/api/raffle/reset', csrfToken, { password, wipeGifts });
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
        Wipes entries and draw results so the raffle can be opened again from scratch. Close the raffle first —
        this is disabled while it's open. Requires your own admin password to confirm.
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
            checked={wipeGifts}
            onInput={(e) => setWipeGifts(e.currentTarget.checked)}
            disabled={disabled}
          />
          {' '}Also wipe the gift list (you'll need to reconfigure it)
        </label>
        <button type="submit" className="btn-danger" disabled={disabled || !password}>
          Reset raffle
        </button>
      </form>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}

export function SealExportCard({ onSealed }) {
  const [result, setResult] = useState(null);

  async function handleExport() {
    const res = await fetch('/admin/api/raffle/registrations/export', { credentials: 'same-origin' });
    const count = res.headers.get('x-entry-count');
    const sha256 = res.headers.get('x-sha-256');
    setResult(`entries: ${count}\nsha256: ${sha256}`);
    if (res.ok) onSealed?.();
  }

  return (
    <div className="card">
      <h2>3. Seal the registration list (before drawing)</h2>
      <p>Exports the registration CSV, computes its SHA-256, and shows the count + hash on the big screen.</p>
      <button onClick={handleExport}>Export &amp; seal</button>
      {result && <pre>{result}</pre>}
      <p><a href="/admin/api/raffle/registrations/export">Download registrations CSV directly</a></p>
    </div>
  );
}

export function DrawNextCard({ csrfToken }) {
  const [result, setResult] = useState(null);

  async function handleDraw() {
    const { data } = await postJson('/admin/api/raffle/draw/next', csrfToken, {});
    setResult(data);
  }

  return (
    <div className="card">
      <h2>4. Draw</h2>
      <button onClick={handleDraw}>Draw next winner</button>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
