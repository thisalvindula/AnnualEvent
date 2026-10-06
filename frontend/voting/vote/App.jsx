import { useEffect, useState } from 'preact/hooks';
import { Message } from '../../shared/ui/Message.jsx';

const STATUS_POLL_MS = 5000;

async function fetchStatus() {
  const res = await fetch('/vote/api/status');
  return res.json();
}

export function App() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(false);
  const [empId, setEmpId] = useState('');
  const [last4, setLast4] = useState('');
  const [pending, setPending] = useState(null); // { empId, last4, name, finalists }
  const [finalistId, setFinalistId] = useState(null);
  const [message, setMessage] = useState(null); // { text, kind }
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const data = await fetchStatus();
        if (!cancelled) {
          setStatus(data);
          setStatusError(false);
        }
      } catch {
        if (!cancelled) setStatusError(true);
      }
    }
    poll();
    const id = setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function handleVerify(e) {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await fetch('/vote/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId, last4 }),
      });
      const body = await res.json();
      if (body.ok) {
        setPending({ empId, last4, name: body.name, finalists: body.finalists });
        setFinalistId(null);
      } else {
        setMessage({ text: body.message || 'Verification failed', kind: 'error' });
      }
    } catch {
      setMessage({ text: 'Could not reach the server. Check your connection and try again.', kind: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCast(e) {
    e.preventDefault();
    setMessage(null);
    if (!pending || finalistId == null) return;
    setSubmitting(true);
    try {
      const res = await fetch('/vote/api/cast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId: pending.empId, last4: pending.last4, finalistId: Number(finalistId) }),
      });
      const body = await res.json();
      if (body.ok) {
        setMessage({ text: 'Vote recorded. Thank you!', kind: 'success' });
        setDone(true);
        setPending(null);
      } else {
        setMessage({ text: body.message || 'Voting failed', kind: 'error' });
      }
    } catch {
      setMessage({ text: 'Could not reach the server. Check your connection and try again.', kind: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  let statusText = 'Checking status…';
  let statusClass = '';
  if (statusError) {
    statusText = 'Unable to reach the server. Check your connection.';
  } else if (status) {
    if (status.isOpen) {
      const m = Math.floor(status.secondsRemaining / 60);
      const s = String(status.secondsRemaining % 60).padStart(2, '0');
      statusText = `Voting is open — closes in ${m}:${s}`;
      statusClass = 'open';
    } else if (status.status === 'closed') {
      statusText = 'Voting is closed.';
      statusClass = 'closed';
    } else {
      statusText = 'Voting has not opened yet.';
    }
  }

  const showVerifyForm = Boolean(status?.isOpen) && !pending && !done;
  const showCastForm = Boolean(pending) && !done;

  return (
    <div className="page">
      <div className="brand">
        <span className="mark" />
        <span className="name">Annual Event · Voting</span>
      </div>
      <h1>Singing Competition</h1>
      <div id="status" className={statusClass}>{statusText}</div>

      {showVerifyForm && (
        <form onSubmit={handleVerify}>
          <label htmlFor="empId">Employee number</label>
          <input
            id="empId"
            required
            autoComplete="off"
            inputMode="numeric"
            value={empId}
            onInput={(e) => setEmpId(e.currentTarget.value)}
          />
          <label htmlFor="last4">Last 4 digits of NIC (or full NIC)</label>
          <input
            id="last4"
            required
            autoComplete="off"
            inputMode="numeric"
            value={last4}
            onInput={(e) => setLast4(e.currentTarget.value)}
          />
          <button type="submit" disabled={submitting}>{submitting ? 'Checking…' : 'Check'}</button>
        </form>
      )}

      {showCastForm && (
        <form onSubmit={handleCast}>
          <p>Hi {pending.name}, choose one finalist:</p>
          <div>
            {pending.finalists.map((f) => (
              <label className="finalist" key={f.id}>
                <input
                  type="radio"
                  name="finalistId"
                  value={f.id}
                  required
                  checked={finalistId === String(f.id)}
                  onChange={() => setFinalistId(String(f.id))}
                />
                {f.name}
                {f.song && <div className="song">{f.song}</div>}
              </label>
            ))}
          </div>
          <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit vote'}</button>
        </form>
      )}

      <div id="message">
        <Message text={message?.text} kind={message?.kind} />
      </div>
      <p className="hint">Your vote is final and cannot be changed. Use mobile data, not venue Wi-Fi.</p>
    </div>
  );
}
