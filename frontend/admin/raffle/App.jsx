import { useCallback, useEffect, useState } from 'preact/hooks';
import { fetchCsrfToken, getJson } from '../../shared/csrf.js';
import { StatusPill } from '../../shared/ui/StatusPill.jsx';
import { GiftConfigForm } from './GiftConfigForm.jsx';
import { OpenCloseForm, SealExportCard, DrawNextCard, ResetCard } from './DrawControls.jsx';

export function App() {
  const [csrfToken, setCsrfToken] = useState(null);
  const [detail, setDetail] = useState(undefined); // undefined = loading

  const loadDetail = useCallback(async () => {
    const { status, data } = await getJson('/admin/api/raffle/detail');
    if (status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    if (status === 403) {
      setDetail(null);
      return;
    }
    setDetail(data);
  }, []);

  useEffect(() => {
    fetchCsrfToken().then(setCsrfToken).catch(() => {});
    loadDetail();
  }, [loadDetail]);

  if (detail === undefined) return null;

  if (detail === null) {
    return (
      <div className="page-wide">
        <div className="topbar">
          <a className="back-link" href="/admin">← Back to dashboard</a>
        </div>
        <h1>Raffle Admin</h1>
        <p className="error">You don't have access to the raffle admin area.</p>
      </div>
    );
  }

  return (
    <div className="page-wide">
      <div className="topbar">
        <a className="back-link" href="/admin">← Back to dashboard</a>
        <StatusPill status={detail.status} />
      </div>
      <h1>Raffle Admin</h1>

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-label">Status</div>
          <div className="stat-value">{detail.status}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Entries</div>
          <div className="stat-value">{detail.entryCount}</div>
        </div>
      </div>

      <GiftConfigForm csrfToken={csrfToken} giftsConfigured={detail.giftsConfigured} onSaved={loadDetail} />
      <OpenCloseForm csrfToken={csrfToken} onChanged={loadDetail} />
      <SealExportCard onSealed={loadDetail} />
      <DrawNextCard csrfToken={csrfToken} />

      <div className="card">
        <h2>5. Results</h2>
        <p><a href="/admin/api/raffle/results/export">Download draw results CSV</a></p>
      </div>

      <ResetCard csrfToken={csrfToken} status={detail.status} onReset={loadDetail} />
    </div>
  );
}
