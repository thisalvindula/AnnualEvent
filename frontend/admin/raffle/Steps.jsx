import { useState } from 'preact/hooks';
import { postJson } from '../../shared/csrf.js';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.jsx';
import { EmployeePhoto } from '../../shared/ui/EmployeePhoto.jsx';
import { Message } from '../../shared/ui/Message.jsx';
import { failure, ViewOnly as SharedViewOnly, StepHeader, useSecondsLeft, formatClock } from '../../shared/ui/WorkflowBits.jsx';
import { GiftConfigForm } from './GiftConfigForm.jsx';

const ViewOnly = () => <SharedViewOnly who="raffle operator" />;

/* ---------- 1. prizes ---------- */

export function PrizesStep({ ctx }) {
  const { detail, csrfToken, canEdit, reload, goTo, number, total } = ctx;
  return (
    <>
      <StepHeader number={number} total={total} title="Set up the prizes" />
      <GiftConfigForm
        csrfToken={csrfToken}
        gifts={detail.gifts}
        totalPrizes={detail.totalPrizes}
        canEdit={canEdit}
        onSaved={reload}
      />
      {detail.totalPrizes > 0 && (
        <div className="actions">
          <button type="button" className="btn-big" onClick={() => goTo('register')}>
            Next: open registration →
          </button>
        </div>
      )}
    </>
  );
}

/* ---------- 2. registration ---------- */

const MINUTE_CHOICES = [5, 10, 15, 30, 60];

function OpenForm({ ctx, label }) {
  const { csrfToken, reload } = ctx;
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function open() {
    setBusy(true);
    setError(null);
    const res = await postJson('/admin/api/raffle/open', csrfToken, { windowMinutes: Number(minutes) });
    setBusy(false);
    if (!res.ok || !res.data.ok) return setError(failure(res));
    reload();
  }

  return (
    <>
      <label htmlFor="windowMinutes">How long should registration stay open?</label>
      <div className="minutes-field">
        <input
          id="windowMinutes"
          type="number"
          min="1"
          value={minutes}
          onInput={(e) => setMinutes(e.currentTarget.value)}
        />
        <span>minutes</span>
      </div>
      <div className="chip-row">
        {MINUTE_CHOICES.map((m) => (
          <button
            key={m}
            type="button"
            className={`chip${Number(minutes) === m ? ' active' : ''}`}
            onClick={() => setMinutes(m)}
          >
            {m} min
          </button>
        ))}
      </div>
      <div className="actions">
        <button type="button" className="btn-big" onClick={open} disabled={busy || !(Number(minutes) > 0)}>
          {label}
        </button>
      </div>
      <Message text={error} kind="error" />
    </>
  );
}

export function RegisterStep({ ctx }) {
  const { detail, csrfToken, canEdit, reload, goTo, number, total } = ctx;
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const secondsLeft = useSecondsLeft(detail.secondsRemaining);
  const drawn = ctx.drawnCount;

  async function close() {
    setBusy(true);
    setError(null);
    const res = await postJson('/admin/api/raffle/close', csrfToken, {});
    setBusy(false);
    setConfirmClose(false);
    if (!res.ok || !res.data.ok) return setError(failure(res));
    reload();
  }

  if (detail.status === 'open') {
    return (
      <>
        <StepHeader number={number} total={total} title="Registration is open">
          Employees can now sign in on their own device and enter the raffle. Watch the entries come in, then close
          registration when you're ready. It also closes by itself when the timer reaches zero.
        </StepHeader>
        <div className="big-stats">
          <div className="big-stat">
            <div className="label">Employees entered</div>
            <div className="value">{detail.entryCount}</div>
          </div>
          <div className="big-stat">
            <div className="label">Time left</div>
            <div className="value">{formatClock(secondsLeft)}</div>
          </div>
        </div>
        {canEdit ? (
          <div className="actions">
            <button type="button" className="btn-big btn-danger" onClick={() => setConfirmClose(true)}>
              Close registration now
            </button>
          </div>
        ) : (
          <ViewOnly />
        )}
        <Message text={error} kind="error" />
        <ConfirmDialog
          open={confirmClose}
          title="Close registration?"
          confirmLabel="Yes, close registration"
          busy={busy}
          onConfirm={close}
          onCancel={() => setConfirmClose(false)}
        >
          <p>
            <strong>{detail.entryCount}</strong> employee{detail.entryCount === 1 ? ' has' : 's have'} entered so far.
            After you close registration nobody else can enter.
          </p>
        </ConfirmDialog>
      </>
    );
  }

  if (detail.status === 'closed') {
    return (
      <>
        <StepHeader number={number} total={total} title="Registration is closed">
          No more employees can enter.
        </StepHeader>
        <div className="big-stats">
          <div className="big-stat">
            <div className="label">Employees entered</div>
            <div className="value">{detail.entryCount}</div>
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn-big" onClick={() => goTo('lock')}>
            Next: lock the entry list →
          </button>
        </div>
        {canEdit && drawn === 0 && (
          <details className="tech">
            <summary>Closed by mistake? Reopen registration</summary>
            <OpenForm ctx={ctx} label="Reopen registration" />
          </details>
        )}
      </>
    );
  }

  // draft
  return (
    <>
      <StepHeader number={number} total={total} title="Open registration">
        Once you open registration, employees can sign in on their own device and enter the raffle. Choose how long it
        should stay open.
      </StepHeader>
      {canEdit ? <OpenForm ctx={ctx} label="Open registration" /> : <ViewOnly />}
    </>
  );
}

/* ---------- 3. lock the entry list ---------- */

export function LockStep({ ctx }) {
  const { detail, canEdit, sealed, setSealed, goTo, number, total } = ctx;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function lock() {
    setBusy(true);
    setError(null);
    const res = await fetch('/admin/api/raffle/registrations/export', { credentials: 'same-origin' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      return setError(data.message ?? 'Could not save the entry list. Please try again.');
    }
    setSealed({ count: res.headers.get('x-entry-count'), sha256: res.headers.get('x-sha-256') });
    setBusy(false);
  }

  return (
    <>
      <StepHeader number={number} total={total} title="Lock the entry list">
        Required before drawing. This saves the final list of entries and shows the total on the big screen, so
        everyone can see the list can't change while winners are drawn.
      </StepHeader>

      {sealed ? (
        <div className="callout success">
          ✓ Entry list saved — <strong>{sealed.count}</strong> entr{Number(sealed.count) === 1 ? 'y' : 'ies'}.
          <details className="tech">
            <summary>Technical details (for auditors)</summary>
            Fingerprint (SHA-256): <code>{sealed.sha256}</code>
          </details>
        </div>
      ) : canEdit ? (
        <div className="actions">
          <button type="button" className="btn-big" onClick={lock} disabled={busy}>
            Lock the entry list
          </button>
        </div>
      ) : (
        <ViewOnly />
      )}
      <Message text={error} kind="error" />

      <div className="actions">
        {sealed && (
          <button type="button" className="btn-big" onClick={() => goTo('draw')}>
            Next: draw winners →
          </button>
        )}
        <a className="btn btn-secondary" href="/admin/api/raffle/registrations/export">
          Download the entry list (CSV)
        </a>
      </div>
      {detail.entryCount === 0 && <p className="callout warn">Nobody has entered the raffle yet, so there is nothing to draw from.</p>}
    </>
  );
}

/* ---------- 4. draw ---------- */

export function DrawStep({ ctx }) {
  const { detail, csrfToken, canEdit, reload, goTo, number, total, winners, addWinner } = ctx;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const nextGift = [...detail.gifts].sort((a, b) => a.id - b.id).find((g) => g.drawn < g.quantity);
  const drawn = ctx.drawnCount;
  const remaining = detail.totalPrizes - drawn;
  const latest = winners[0];

  async function draw() {
    setBusy(true);
    setError(null);
    const res = await postJson('/admin/api/raffle/draw/next', csrfToken, {});
    setBusy(false);
    setConfirm(false);
    if (!res.ok || !res.data.ok) return setError(failure(res));
    addWinner(res.data);
    reload();
  }

  if (!nextGift) {
    return (
      <>
        <StepHeader number={number} total={total} title="All winners drawn 🎉" />
        {latest && <WinnerCard winner={latest} />}
        <div className="actions">
          <button type="button" className="btn-big" onClick={() => goTo('results')}>
            Next: see the results →
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <StepHeader number={number} total={total} title="Draw winners">
        Each press of the button picks one winner at random for the next prize. The winner is also shown on the big
        screen.
      </StepHeader>

      <div className="progress" aria-hidden="true">
        <span style={{ width: `${detail.totalPrizes ? (drawn / detail.totalPrizes) * 100 : 0}%` }} />
      </div>
      <p className="hint">{drawn} of {detail.totalPrizes} winners drawn · {remaining} to go</p>

      <div className="next-up">
        <div className="hint">Next prize</div>
        <div className="prize">{nextGift.place} — {nextGift.description}</div>
        <div className="hint">Winner {nextGift.drawn + 1} of {nextGift.quantity} for this prize</div>
      </div>

      {canEdit ? (
        <div className="actions">
          <button type="button" className="btn-big" onClick={() => setConfirm(true)} disabled={busy}>
            Draw the next winner
          </button>
        </div>
      ) : (
        <ViewOnly />
      )}
      <Message text={error} kind="error" />

      {latest && (
        <>
          <h3>Latest winner</h3>
          <WinnerCard winner={latest} />
        </>
      )}
      {winners.length > 1 && (
        <>
          <h3>Earlier winners (this session)</h3>
          <ul className="winner-log">
            {winners.slice(1).map((w) => (
              <li key={`${w.giftId}-${w.slot}`}>
                <EmployeePhoto imageName={w.imageName} name={w.name} />
                <span>{w.name} <span className="hint">({w.empId})</span></span>
                <span className="prize">{w.place}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title="Draw the next winner?"
        confirmLabel="Yes, draw now"
        busy={busy}
        onConfirm={draw}
        onCancel={() => setConfirm(false)}
      >
        <p>
          This picks the winner of <strong>{nextGift.place} — {nextGift.description}</strong>. A drawn winner can't be
          undone.
        </p>
      </ConfirmDialog>
    </>
  );
}

function WinnerCard({ winner }) {
  return (
    <div className="winner-card">
      <EmployeePhoto imageName={winner.imageName} name={winner.name} />
      <div>
        <div className="prize">{winner.place} — {winner.description}</div>
        <div className="name">{winner.name}</div>
        <div className="meta">Employee {winner.empId}</div>
      </div>
    </div>
  );
}

/* ---------- 5. results ---------- */

export function ResultsStep({ ctx }) {
  const { detail, number, total } = ctx;
  const allDone = detail.totalPrizes > 0 && ctx.drawnCount === detail.totalPrizes;
  return (
    <>
      <StepHeader number={number} total={total} title="Results">
        {allDone
          ? 'The raffle is complete. Download the list of winners to share with the team.'
          : `${ctx.drawnCount} of ${detail.totalPrizes} winners drawn so far. You can download the list at any time.`}
      </StepHeader>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Draw order</th><th>Place</th><th>Description</th><th>Winners drawn</th></tr>
          </thead>
          <tbody>
            {[...detail.gifts].sort((a, b) => a.id - b.id).map((g) => (
              <tr key={g.id}>
                <td>{g.id}</td>
                <td>{g.place}</td>
                <td>{g.description}</td>
                <td>{g.drawn} of {g.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <a className="btn btn-big" href="/admin/api/raffle/results/export">Download the winners (CSV)</a>
        <a className="btn btn-secondary" href="/admin/api/raffle/registrations/export">Download the entry list (CSV)</a>
      </div>
    </>
  );
}

/* ---------- start over (danger zone) ---------- */

export function StartOver({ detail, csrfToken, onReset }) {
  const [password, setPassword] = useState('');
  const [wipeGifts, setWipeGifts] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const disabled = detail.status === 'open';

  async function reset() {
    setBusy(true);
    const res = await postJson('/admin/api/raffle/reset', csrfToken, { password, wipeGifts });
    setBusy(false);
    setConfirm(false);
    if (!res.ok || !res.data.ok) return setResult({ kind: 'error', text: failure(res) });
    setPassword('');
    setResult({ kind: 'success', text: 'The raffle has been reset. You can start again from step 2.' });
    onReset();
  }

  return (
    <details className="danger-zone">
      <summary>Start over (erases entries and winners)</summary>
      <div className="danger-body">
        <p>
          This erases everyone's entries and all winners so the raffle can be run again from the beginning. It can't be
          undone.
          {disabled && ' Close registration first — this is unavailable while registration is open.'}
        </p>
        <label htmlFor="resetPassword">Type your admin password to confirm</label>
        <input
          id="resetPassword"
          type="password"
          autoComplete="current-password"
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
          disabled={disabled}
        />
        <label className="check-line">
          <input
            type="checkbox"
            checked={wipeGifts}
            onInput={(e) => setWipeGifts(e.currentTarget.checked)}
            disabled={disabled}
          />
          Also erase the prize list
        </label>
        <div className="actions">
          <button type="button" className="btn-danger" onClick={() => setConfirm(true)} disabled={disabled || !password}>
            Start over
          </button>
        </div>
        {result && <Message text={result.text} kind={result.kind} />}
      </div>
      <ConfirmDialog
        open={confirm}
        danger
        title="Erase and start over?"
        confirmLabel="Yes, erase everything"
        busy={busy}
        onConfirm={reset}
        onCancel={() => setConfirm(false)}
      >
        <p>
          All entries and winners will be erased{wipeGifts ? ', along with the prize list' : ' (the prize list is kept)'}.
          This can't be undone.
        </p>
      </ConfirmDialog>
    </details>
  );
}
