import { useEffect, useState } from 'preact/hooks';
import { Message } from '../../shared/ui/Message.jsx';

const STATUS_POLL_MS = 5000;

async function fetchStatus() {
  const res = await fetch('/raffle/api/status');
  return res.json();
}

export function App() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(false);
  const [empId, setEmpId] = useState('');
  const [last4, setLast4] = useState('');
  const [pending, setPending] = useState(null); // { empId, last4, name }
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
      const res = await fetch('/raffle/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId, last4 }),
      });
      const body = await res.json();
      if (body.ok) {
        setPending({ empId, last4, name: body.name });
      } else {
        setMessage({ text: body.message || 'Verification failed', kind: 'error' });
      }
    } catch {
      setMessage({ text: 'Could not reach the server. Check your connection and try again.', kind: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setMessage(null);
    if (!pending) return;
    setSubmitting(true);
    try {
      const res = await fetch('/raffle/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId: pending.empId, last4: pending.last4 }),
      });
      const body = await res.json();
      if (body.ok) {
        setMessage({ text: `You're registered! Ticket #${body.ticketNo}`, kind: 'success' });
        setDone(true);
        setPending(null);
      } else {
        setMessage({ text: body.message || 'Registration failed', kind: 'error' });
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
      statusText = `Registration is open — closes in ${m}:${s}`;
      statusClass = 'open';
    } else if (status.status === 'closed') {
      statusText = 'Registration is closed.';
      statusClass = 'closed';
    } else {
      statusText = 'Registration has not opened yet.';
    }
  }

  const showVerifyForm = Boolean(status?.isOpen) && !pending && !done;
  const showConfirmForm = Boolean(pending) && !done;

  return (
    <div className="page">
      <div className="brand">
        <span className="mark" />
        <span className="name">Annual Event · Raffle</span>
      </div>
      <h1>Raffle Registration</h1>
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

      {showConfirmForm && (
        <form onSubmit={handleConfirm}>
          <p>Register {pending.name} ({pending.empId})?</p>
          <button type="submit" disabled={submitting}>{submitting ? 'Registering…' : 'Confirm registration'}</button>
        </form>
      )}

      <div id="message">
        <Message text={message?.text} kind={message?.kind} />
      </div>
      <p className="hint">Use mobile data, not venue Wi-Fi, for the fastest response.</p>
    </div>
  );
}
