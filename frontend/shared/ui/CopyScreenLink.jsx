import { useState } from 'preact/hooks';

// Copies the big-screen URL (secret token included) so the operator can open
// it on the projector machine. Only ever rendered inside the admin area.
export function CopyScreenLink({ path }) {
  const [state, setState] = useState('idle'); // idle | copied | failed
  if (!path) return null;

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API needs https/localhost; fall back for plain-http LAN hosts.
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (!ok) {
        setState('failed');
        return;
      }
    }
    setState('copied');
    setTimeout(() => setState('idle'), 2000);
  }

  return (
    <p style={{ margin: '0 0 16px' }}>
      <button type="button" className="btn-secondary" onClick={copy}>
        {state === 'copied' ? 'Link copied ✓' : state === 'failed' ? 'Copy failed' : 'Copy big-screen link'}
      </button>
    </p>
  );
}
