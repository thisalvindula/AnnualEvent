import { useEffect, useState } from 'preact/hooks';
import { fetchCsrfToken, getJson } from '../../shared/csrf.js';
import { StatusPill } from '../../shared/ui/StatusPill.jsx';
import { ClearDatabaseCard } from './ClearDatabaseCard.jsx';

async function fetchModuleStatus(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) return null;
  return res.json();
}

export function App() {
  const [me, setMe] = useState(undefined); // undefined = loading, null = unauthenticated
  const [csrfToken, setCsrfToken] = useState(null);
  const [raffleStatus, setRaffleStatus] = useState(null);
  const [voteStatus, setVoteStatus] = useState(null);
  const [importResult, setImportResult] = useState(null);

  function refreshModuleStatuses() {
    fetchModuleStatus('/admin/api/raffle/detail').then((d) => setRaffleStatus(d ? d.status : 'unknown'));
    fetchModuleStatus('/admin/api/vote/detail').then((d) => setVoteStatus(d ? d.status : 'unknown'));
  }

  useEffect(() => {
    getJson('/admin/api/me').then(({ status, data }) => {
      if (status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      setMe(data);
    });
    fetchCsrfToken().then(setCsrfToken).catch(() => {});
    refreshModuleStatuses();
  }, []);

  async function handleLogout(e) {
    e.preventDefault();
    if (!csrfToken) return;
    await fetch('/admin/logout', { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
    window.location.href = '/admin/login';
  }

  async function handleImport(e) {
    e.preventDefault();
    const file = e.target.elements.csvFile.files[0];
    if (!file || !csrfToken) return;
    const text = await file.text();
    const res = await fetch('/admin/api/employees/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'x-csrf-token': csrfToken },
      body: text,
    });
    const body = await res.json().catch(() => ({}));
    setImportResult(body);
  }

  if (me === undefined) return null;

  return (
    <div className="page-wide">
      <div className="topbar">
        <div className="brand" style={{ marginBottom: 0 }}>
          <span className="mark" />
          <span className="name">Annual Event Admin</span>
        </div>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--muted)' }}>
          Logged in as <strong style={{ color: 'var(--navy-900)' }}>{me.username}</strong> ({me.role})
          {' — '}
          <a href="#" onClick={handleLogout}>Log out</a>
        </p>
      </div>
      <h1>Dashboard</h1>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Raffle</div>
          <div className="stat-value" style={{ fontSize: '1.15rem' }}>
            {raffleStatus && raffleStatus !== 'unknown' ? <StatusPill status={raffleStatus} /> : '—'}
          </div>
          <a href="/admin/raffle">Manage →</a>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Voting</div>
          <div className="stat-value" style={{ fontSize: '1.15rem' }}>
            {voteStatus && voteStatus !== 'unknown' ? <StatusPill status={voteStatus} /> : '—'}
          </div>
          <a href="/admin/vote">Manage →</a>
        </div>
      </div>

      <div className="card">
        <h2>Lists</h2>
        <p>Browse the employee roster, the raffle gift list and the voting finalists.</p>
        <a href="/admin/lists">View lists →</a>
      </div>

      <div className="card">
        <h2>Employee master list</h2>
        <p>Upload a CSV with header <code>emp_id,name,dept,nic</code>. Existing employee IDs are updated in place.</p>
        <form onSubmit={handleImport}>
          <label htmlFor="csvFile">CSV file</label>
          <input id="csvFile" name="csvFile" type="file" accept=".csv,text/csv" required />
          <button type="submit">Import</button>
        </form>
        {importResult && <pre>{JSON.stringify(importResult, null, 2)}</pre>}
      </div>

      <div className="card">
        <h2>Audit log</h2>
        <p><a href="/admin/api/audit/export">Download full audit log (CSV)</a> — requires the auditor role.</p>
      </div>

      <ClearDatabaseCard
        csrfToken={csrfToken}
        raffleStatus={raffleStatus}
        voteStatus={voteStatus}
        onCleared={refreshModuleStatuses}
      />
    </div>
  );
}
