import { useEffect, useState } from 'preact/hooks';
import { QR_MODULES, moduleQrUrl, renderQrDataUrl, renderQrPosterBlob } from '../../shared/qr.js';

function QrItem({ module, name }) {
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    moduleQrUrl(module)
      .then(async (r) => ({ ...r, dataUrl: await renderQrDataUrl(r.url, 300) }))
      .then((r) => !cancelled && setQr(r));
    return () => {
      cancelled = true;
    };
  }, [module]);

  async function download() {
    setBusy(true);
    try {
      const blob = await renderQrPosterBlob(module, qr.url);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = QR_MODULES[module].file;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="qr-item">
      {qr ? <img src={qr.dataUrl} alt={`${name} QR code`} width="150" height="150" /> : <div className="qr-ph" />}
      <div className="step-text">
        <span className="step-title">{name}</span>
        <span className="step-sub">{qr ? qr.url : 'Loading…'}</span>
      </div>
      <button type="button" className="btn-secondary" disabled={!qr || busy} onClick={download}>
        {busy ? 'Preparing…' : 'Download PNG'}
      </button>
    </div>
  );
}

export function QrCodesCard() {
  const [configured, setConfigured] = useState(true);
  useEffect(() => {
    moduleQrUrl('raffle').then((r) => setConfigured(r.configured));
  }, []);

  return (
    <div className="qr-card">
      <p className="step-sub">
        These never change. Download and print them before the event. Raffle and voting each have their own code.
      </p>
      {!configured && (
        <p className="qr-warn">
          PUBLIC_BASE_URL is not set on the server, so these codes use this browser's address. Set it and restart before printing.
        </p>
      )}
      <QrItem module="raffle" name="Raffle" />
      <QrItem module="vote" name="Voting" />
    </div>
  );
}
