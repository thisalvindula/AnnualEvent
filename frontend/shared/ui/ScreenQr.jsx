import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';

// Renders a scannable QR pointing at an employee-facing path (e.g. /vote,
// /raffle) on this same origin, generated client-side so the big-screen
// pages never depend on an external QR service.
export function ScreenQr({ path, label }) {
  const url = `${location.origin}${path}`;
  const [dataUrl, setDataUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: 440,
      margin: 1,
      color: { dark: '#0a1428', light: '#ffffffff' },
    }).then((result) => {
      if (!cancelled) setDataUrl(result);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div className="screen-qr-panel">
      <div className="screen-qr-card">
        {dataUrl ? <img src={dataUrl} alt={`QR code to ${label}`} width={220} height={220} /> : <div className="screen-qr-placeholder" />}
      </div>
      <div className="screen-qr-caption">
        <span className="screen-qr-label">Scan to {label}</span>
        <span className="screen-qr-url">{url.replace(/^https?:\/\//, '')}</span>
      </div>
    </div>
  );
}
