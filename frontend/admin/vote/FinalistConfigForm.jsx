import { useState } from 'preact/hooks';
import { postJson } from '../../shared/csrf.js';

const POSITIONS = [1, 2, 3, 4, 5];

export function FinalistConfigForm({ csrfToken, finalistsConfigured, onSaved }) {
  const [names, setNames] = useState({});
  const [songs, setSongs] = useState({});
  const [empIds, setEmpIds] = useState({});
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const finalists = POSITIONS.map((pos) => ({
      name: (names[pos] || '').trim(),
      song: (songs[pos] || '').trim() || null,
      position: pos,
      empId: (empIds[pos] || '').trim() || null,
    }));
    const { data } = await postJson('/admin/api/vote/finalists', csrfToken, { finalists });
    setResult(data);
    if (data.ok) onSaved?.();
  }

  return (
    <div className="card">
      <h2>1. Finalists (exactly 5)</h2>
      <p>Currently configured: <strong>{finalistsConfigured ? 'yes' : 'no'}</strong>. Locked once voting starts.</p>
      <form onSubmit={handleSubmit}>
        {POSITIONS.map((pos) => (
          <div className="finalist-row" key={pos}>
            <span>{pos}.</span>
            <input
              placeholder="Finalist name"
              required
              value={names[pos] || ''}
              onInput={(e) => setNames((prev) => ({ ...prev, [pos]: e.currentTarget.value }))}
            />
            <input
              placeholder="Song (optional)"
              value={songs[pos] || ''}
              onInput={(e) => setSongs((prev) => ({ ...prev, [pos]: e.currentTarget.value }))}
            />
            <input
              placeholder="Employee ID (optional, for photo)"
              value={empIds[pos] || ''}
              onInput={(e) => setEmpIds((prev) => ({ ...prev, [pos]: e.currentTarget.value }))}
            />
          </div>
        ))}
        <button type="submit">Save finalists</button>
      </form>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
