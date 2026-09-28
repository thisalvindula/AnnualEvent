import { useEffect, useState } from 'preact/hooks';

// Plain fetch-polling hook, used alongside useEventSource on the big-screen
// pages for the ticking countdown clock (SSE carries discrete events; the
// clock is polled every second, matching the pre-React screen.js behavior).
export function usePolling(url, intervalMs) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        const body = await res.json();
        if (!cancelled) setData(body);
      } catch {
        // keep last known value on transient network errors
      }
    }

    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [url, intervalMs]);

  return data;
}
