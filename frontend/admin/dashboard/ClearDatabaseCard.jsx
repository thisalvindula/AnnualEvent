import { useState } from 'preact/hooks';
import { postJson } from '../../shared/csrf.js';

export function ClearDatabaseCard({ csrfToken, raffleStatus, voteStatus, onCleared }) {
  const [password, setPassword] = useState('');
  const [result, setResult] = useState(null);

  const disabled = raffleStatus === 'open' || voteStatus === 'open';

  async function handleClear(e) {
    e.preventDefault();
    const confirmed = window.confirm(
      'This permanently wipes employees, raffle entries/gifts/draw results, and voting finalists/votes. ' +
        'Admin accounts and the audit log are kept. This cannot be undone. Continue?'
    );
    if (!confirmed) return;

    const { data } = await postJson('/admin/api/system/clear', csrfToken, { password });
    setResult(data);
    if (data.ok) {
      setPassword('');
      onCleared?.();
    }
  }

  return (
    <div className="card">
      <h2>Clear database</h2>
      <p>
        Wipes all employees, raffle data, and voting data so the event can start completely fresh. Admin accounts
        and the audit log are kept. Close the raffle and voting first — this is disabled while either is open.
        Requires your own admin password to confirm.
      </p>
      <form onSubmit={handleClear}>
        <label htmlFor="clearPassword">Your admin password</label>
        <input
          id="clearPassword"
          type="password"
          autoComplete="current-password"
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
          disabled={disabled}
        />
        <button type="submit" className="btn-danger" disabled={disabled || !password}>
          Clear database
        </button>
      </form>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
