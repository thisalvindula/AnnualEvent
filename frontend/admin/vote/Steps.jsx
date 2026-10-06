import { useState } from 'preact/hooks';
import { postJson } from '../../shared/csrf.js';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog.jsx';
import { EmployeePhoto } from '../../shared/ui/EmployeePhoto.jsx';
import { Message } from '../../shared/ui/Message.jsx';
import { failure, ViewOnly as SharedViewOnly, StepHeader, useSecondsLeft, formatClock } from '../../shared/ui/WorkflowBits.jsx';

const ViewOnly = () => <SharedViewOnly who="vote operator" />;

const POSITIONS = [1, 2, 3, 4, 5];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---------- 1. finalists ---------- */

const toRows = (finalists) =>
  POSITIONS.map((position) => {
    const f = finalists.find((x) => x.position === position);
    return { name: f?.name ?? '', song: f?.song ?? '', empId: f?.empId ?? '' };
  });

export function FinalistsStep({ ctx }) {
  const { detail, csrfToken, canEdit, reload, goTo, number, total } = ctx;
  const [rows, setRows] = useState(() => toRows(detail.finalists));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const locked = detail.status !== 'draft';
  const editable = canEdit && !locked;
  const set = (i, key) => (e) => {
    const value = e.currentTarget.value;
    setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  };

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    const finalists = rows.map((row, i) => ({
      name: row.name.trim(),
      song: row.song.trim() || null,
      position: i + 1,
      empId: row.empId.trim() || null,
    }));
    const res = await postJson('/admin/api/vote/finalists', csrfToken, { finalists });
    setBusy(false);
    if (!res.ok || !res.data.ok) return setResult({ kind: 'error', text: failure(res) });
    setResult({ kind: 'success', text: 'Finalists saved.' });
    reload();
  }

  return (
    <>
      <StepHeader number={number} total={total} title="Set up the finalists">
        Enter the five finalists in the order they should appear on the voting screen. The song is optional. Add an
        employee ID to show that person's photo.
      </StepHeader>

      {locked && <p className="callout warn">Voting has started, so the finalists can't be changed any more.</p>}
      {!canEdit && <ViewOnly />}

      <form onSubmit={save}>
        <div className="finalist-rows">
          {POSITIONS.map((position, i) => {
            const saved = detail.finalists.find((f) => f.position === position);
            return (
              <div className="finalist-row" key={position}>
                <span className="finalist-num">{position}</span>
                <EmployeePhoto imageName={saved?.imageName ?? null} name={rows[i].name || String(position)} />
                <input
                  placeholder="Finalist name"
                  required
                  aria-label={`Finalist ${position} name`}
                  value={rows[i].name}
                  onInput={set(i, 'name')}
                  disabled={!editable}
                />
                <input
                  placeholder="Song (optional)"
                  aria-label={`Finalist ${position} song`}
                  value={rows[i].song}
                  onInput={set(i, 'song')}
                  disabled={!editable}
                />
                <input
                  placeholder="Employee ID (optional)"
                  aria-label={`Finalist ${position} employee ID`}
                  value={rows[i].empId}
                  onInput={set(i, 'empId')}
                  disabled={!editable}
                />
              </div>
            );
          })}
        </div>
        <div className="actions">
          {editable && (
            <button type="submit" className={detail.finalistsConfigured ? 'btn-secondary' : 'btn-big'} disabled={busy}>
              Save finalists
            </button>
          )}
          {detail.finalistsConfigured && (
            <button type="button" className="btn-big" onClick={() => goTo('vote')}>
              Next: open voting →
            </button>
          )}
        </div>
      </form>
      {result && <Message text={result.text} kind={result.kind} />}
    </>
  );
}

/* ---------- 2. voting ---------- */

const MINUTE_CHOICES = [1, 5, 10, 15, 30];

function StartForm({ ctx }) {
  const { detail, csrfToken, reload } = ctx;
  const [minutes, setMinutes] = useState(detail.durationMinutes ?? 15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function start() {
    setBusy(true);
    setError(null);
    const saved = await postJson('/admin/api/vote/config', csrfToken, { durationMinutes: Number(minutes) });
    if (!saved.ok || !saved.data.ok) {
      setBusy(false);
      return setError(failure(saved));
    }
    const res = await postJson('/admin/api/vote/start', csrfToken, {});
    setBusy(false);
    if (!res.ok || !res.data.ok) return setError(failure(res));
    reload();
  }

  return (
    <>
      <label htmlFor="voteMinutes">How long should voting stay open?</label>
      <div className="minutes-field">
        <input
          id="voteMinutes"
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
        <button type="button" className="btn-big" onClick={start} disabled={busy || !(Number(minutes) > 0)}>
          Start voting
        </button>
      </div>
      <Message text={error} kind="error" />
    </>
  );
}

export function VoteStep({ ctx }) {
  const { detail, csrfToken, canEdit, reload, goTo, number, total } = ctx;
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const secondsLeft = useSecondsLeft(detail.secondsRemaining);

  async function act(path, done) {
    setBusy(true);
    setError(null);
    const res = await postJson(path, csrfToken, {});
    setBusy(false);
    done();
    if (!res.ok || !res.data.ok) return setError(failure(res));
    reload();
  }

  if (detail.status === 'open') {
    const timeUp = detail.secondsRemaining === 0 && secondsLeft === 0;
    return (
      <>
        <StepHeader number={number} total={total} title={timeUp ? 'Time is up' : 'Voting is open'}>
          {timeUp
            ? 'The voting time has ended and nobody can vote any more. Finish voting to see the results.'
            : 'Employees can now vote on their own device. Watch the votes come in, then close voting when you\'re ready. It also stops accepting votes by itself when the timer reaches zero.'}
        </StepHeader>
        <div className="big-stats">
          <div className="big-stat">
            <div className="label">Votes cast</div>
            <div className="value">{detail.totalVotes}</div>
          </div>
          <div className="big-stat">
            <div className="label">Time left</div>
            <div className="value">{formatClock(secondsLeft)}</div>
          </div>
        </div>
        {canEdit ? (
          <div className="actions">
            {timeUp ? (
              <button
                type="button"
                className="btn-big"
                onClick={() => act('/admin/api/vote/close', () => {})}
                disabled={busy}
              >
                Finish voting
              </button>
            ) : (
              <button type="button" className="btn-big btn-danger" onClick={() => setConfirmClose(true)}>
                Close voting now
              </button>
            )}
          </div>
        ) : (
          <ViewOnly />
        )}
        <Message text={error} kind="error" />
        <ConfirmDialog
          open={confirmClose}
          title="Close voting?"
          confirmLabel="Yes, close voting"
          busy={busy}
          onConfirm={() => act('/admin/api/vote/close', () => setConfirmClose(false))}
          onCancel={() => setConfirmClose(false)}
        >
          <p>
            <strong>{detail.totalVotes}</strong> vote{detail.totalVotes === 1 ? ' has' : 's have'} been cast so far.
            After you close voting nobody else can vote.
          </p>
        </ConfirmDialog>
      </>
    );
  }

  if (detail.status === 'closed') {
    return (
      <>
        <StepHeader number={number} total={total} title="Voting is closed">
          No more votes can be cast.
        </StepHeader>
        <div className="big-stats">
          <div className="big-stat">
            <div className="label">Votes cast</div>
            <div className="value">{detail.totalVotes}</div>
          </div>
        </div>
        <div className="actions">
          <button type="button" className="btn-big" onClick={() => goTo('results')}>
            Next: see the results →
          </button>
        </div>
        {canEdit && (
          <details className="tech">
            <summary>Closed by mistake? Reopen voting</summary>
            <p className="hint">
              Voting will reopen for another {plural(detail.durationMinutes, 'minute', 'minutes')}. Votes already cast
              are kept and can't be changed.
            </p>
            <div className="actions">
              <button type="button" className="btn-secondary" onClick={() => setConfirmReopen(true)}>
                Reopen voting
              </button>
            </div>
            <Message text={error} kind="error" />
            <ConfirmDialog
              open={confirmReopen}
              title="Reopen voting?"
              confirmLabel="Yes, reopen"
              busy={busy}
              onConfirm={() => act('/admin/api/vote/start', () => setConfirmReopen(false))}
              onCancel={() => setConfirmReopen(false)}
            >
              <p>
                Employees who haven't voted yet will be able to vote for another{' '}
                {plural(detail.durationMinutes, 'minute', 'minutes')}.
              </p>
            </ConfirmDialog>
          </details>
        )}
      </>
    );
  }

  // draft
  return (
    <>
      <StepHeader number={number} total={total} title="Open voting">
        Once you start voting, employees can vote on their own device. Each employee can vote once, and the first vote
        is final. Choose how long voting should stay open.
      </StepHeader>
      {canEdit ? <StartForm ctx={ctx} /> : <ViewOnly />}
    </>
  );
}

/* ---------- 3. results ---------- */

export function ResultsStep({ ctx }) {
  const { detail, isAuditor, number, total } = ctx;
  const top = Math.max(0, ...detail.tally.map((f) => f.votes));
  return (
    <>
      <StepHeader number={number} total={total} title="Results">
        {detail.totalVotes} vote{detail.totalVotes === 1 ? '' : 's'} cast.
      </StepHeader>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>#</th><th></th><th>Finalist</th><th>Song</th><th>Votes</th></tr>
          </thead>
          <tbody>
            {detail.tally.map((f) => (
              <tr key={f.id} className={top > 0 && f.votes === top ? 'leader-row' : undefined}>
                <td>{f.position}</td>
                <td><EmployeePhoto imageName={f.imageName} name={f.name} /></td>
                <td>{f.name}</td>
                <td>{f.song ?? '—'}</td>
                <td><strong>{f.votes}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions">
        {isAuditor ? (
          <a className="btn btn-big" href="/admin/api/vote/results/export">Download the votes (CSV)</a>
        ) : (
          <p className="callout">
            The full votes file (with employee IDs, for audit) can only be downloaded by an auditor.
          </p>
        )}
      </div>
    </>
  );
}

/* ---------- start over (danger zone) ---------- */

export function StartOver({ detail, csrfToken, onReset }) {
  const [password, setPassword] = useState('');
  const [wipeFinalists, setWipeFinalists] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const disabled = detail.status === 'open';

  async function reset() {
    setBusy(true);
    const res = await postJson('/admin/api/vote/reset', csrfToken, { password, wipeFinalists });
    setBusy(false);
    setConfirm(false);
    if (!res.ok || !res.data.ok) return setResult({ kind: 'error', text: failure(res) });
    setPassword('');
    setResult({ kind: 'success', text: 'Voting has been reset. You can start again from step 2.' });
    onReset();
  }

  return (
    <details className="danger-zone">
      <summary>Start over (erases all votes)</summary>
      <div className="danger-body">
        <p>
          This erases every vote so voting can be run again from the beginning. It can't be undone.
          {disabled && ' Close voting first — this is unavailable while voting is open.'}
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
            checked={wipeFinalists}
            onInput={(e) => setWipeFinalists(e.currentTarget.checked)}
            disabled={disabled}
          />
          Also erase the finalist list
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
          All votes will be erased{wipeFinalists ? ', along with the finalist list' : ' (the finalist list is kept)'}.
          This can't be undone.
        </p>
      </ConfirmDialog>
    </details>
  );
}
