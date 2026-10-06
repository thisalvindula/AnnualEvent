import { buildQrGrid } from './qr-grid.js';

const INK = '#0a1428';
const RED = '#ff0000';
const BLUE = '#001f98';

export const QR_MODULES = {
  raffle: { path: '/raffle', title: 'RAFFLE', caption: 'Scan to enter', file: 'amsafe-agt-raffle-qr.png' },
  vote: { path: '/vote', title: 'VOTING', caption: 'Scan to vote', file: 'amsafe-agt-vote-qr.png' },
};

let baseUrlPromise;

// The fixed public address from the server (PUBLIC_BASE_URL). Falls back to the
// current origin only when it is not configured, so dev still works.
export function getPublicBaseUrl() {
  baseUrlPromise ??= fetch('/api/public-config')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((d) => {
      if (d.publicBaseUrl) return { baseUrl: d.publicBaseUrl, configured: true };
      console.warn('PUBLIC_BASE_URL is not set; QR codes use the current address.');
      return { baseUrl: location.origin, configured: false };
    });
  return baseUrlPromise;
}

export async function moduleQrUrl(module) {
  const { baseUrl, configured } = await getPublicBaseUrl();
  return { url: `${baseUrl}${QR_MODULES[module].path}`, configured };
}

const TONES = { dark: INK, red: RED, blue: BLUE };

// Branded QR: level-H code with "AMSAFE" pixel art cut into the centre
// (see qr-grid.js). Drawn module by module so the art is part of the code.
export function renderQrCanvas(url, size = 880) {
  const { n, cells } = buildQrGrid(url);
  const margin = 2;
  const scale = Math.max(1, Math.floor(size / (n + margin * 2)));
  const px = scale * (n + margin * 2);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  cells.forEach((tone, i) => {
    if (!tone) return;
    ctx.fillStyle = TONES[tone];
    ctx.fillRect((margin + (i % n)) * scale, (margin + Math.floor(i / n)) * scale, scale, scale);
  });
  return canvas;
}

export async function renderQrDataUrl(url, size = 440) {
  return renderQrCanvas(url, size).toDataURL('image/png');
}

// Print-ready poster PNG (A4-ish portrait): AMSAFE AGT heading, QR, caption, URL.
export async function renderQrPosterBlob(module, url) {
  const { title, caption } = QR_MODULES[module];
  const W = 1654;
  const H = 2339;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, 360);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 150px system-ui, Arial, sans-serif';
  ctx.fillText('AMSAFE AGT', W / 2, 190);
  ctx.fillStyle = '#c9d2e3';
  ctx.font = '600 70px system-ui, Arial, sans-serif';
  ctx.fillText('ANNUAL EVENT', W / 2, 295);

  ctx.fillStyle = INK;
  ctx.font = '800 170px system-ui, Arial, sans-serif';
  ctx.fillText(title, W / 2, 640);

  const qr = renderQrCanvas(url, 1200);
  ctx.drawImage(qr, (W - qr.width) / 2, 720);

  ctx.fillStyle = INK;
  ctx.font = '700 120px system-ui, Arial, sans-serif';
  ctx.fillText(caption, W / 2, 2080);
  ctx.fillStyle = '#5b6678';
  ctx.font = '500 50px system-ui, Arial, sans-serif';
  ctx.fillText(url.replace(/^https?:\/\//, ''), W / 2, 2190);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
