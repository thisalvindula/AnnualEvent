import { useCallback, useEffect, useState } from 'preact/hooks';
import { fetchCsrfToken, getJson } from '../../shared/csrf.js';
import { CopyScreenLink } from '../../shared/ui/CopyScreenLink.jsx';
import { StatusPill } from '../../shared/ui/StatusPill.jsx';
import { StepList } from '../../shared/ui/StepList.jsx';
import { PrizesStep, RegisterStep, LockStep, DrawStep, ResultsStep, StartOver } from './Steps.jsx';

const STEPS = [
  { key: 'prizes', title: 'Set up the prizes', Component: PrizesStep },
  { key: 'register', title: 'Open registration', Component: RegisterStep },
  { key: 'lock', title: 'Lock the entry list', Component: LockStep },
  { key: 'draw', title: 'Draw winners', Component: DrawStep },
  { key: 'results', title: 'Results', Component: ResultsStep },
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Works out each step's state from what the server says. 'current' steps are
// the ones the operator should be doing right now; 'locked' ones can't be
// opened yet (the summary says why).
function deriveSteps(detail, sealed) {
  const total = detail.totalPrizes;
  const drawn = detail.gifts.reduce((sum, g) => sum + g.drawn, 0);
  const status = detail.status;
  const allDrawn = total > 0 && drawn >= total;

  const state = {
    prizes: total > 0
      ? { state: 'done', summary: `${plural(detail.gifts.length, 'prize', 'prizes')} · ${plural(total, 'winner', 'winners')}` }
      : { state: 'current', summary: 'Nothing added yet' },
    register:
      total === 0
        ? { state: 'locked', summary: 'Add the prizes first' }
        : status === 'open'
          ? { state: 'current', summary: `Open · ${plural(detail.entryCount, 'entry', 'entries')}` }
          : status === 'closed'
            ? { state: 'done', summary: `Closed · ${plural(detail.entryCount, 'entry', 'entries')}` }
            : { state: 'current', summary: 'Not open yet' },
    lock:
      status !== 'closed'
        ? { state: 'locked', summary: 'Available once registration is closed' }
        : sealed
          ? { state: 'done', summary: 'Entry list saved' }
          : { state: 'current', summary: 'Required before drawing' },
    draw:
      status !== 'closed'
        ? { state: 'locked', summary: 'Available once registration is closed' }
        : !sealed
          ? { state: 'locked', summary: 'Lock the entry list first' }
          : allDrawn
            ? { state: 'done', summary: `All ${total} winners drawn` }
            : { state: 'current', summary: `${drawn} of ${total} winners drawn` },
    results:
      drawn === 0
        ? { state: 'locked', summary: 'Available once a winner is drawn' }
        : allDrawn
          ? { state: 'current', summary: 'Raffle complete' }
          : { state: 'todo', summary: 'Download any time' },
  };

  const current = STEPS.find((s) => state[s.key].state === 'current')?.key ?? 'results';
  return { state, current, drawn };
}

export function App() {
  const [csrfToken, setCsrfToken] = useState(null);
  const [detail, setDetail] = useState(undefined); // undefined = loading
  const [role, setRole] = useState(null);
  const [selected, setSelected] = useState(null); // null = follow the current step
  const [sealed, setSealed] = useState(null);
  const [winners, setWinners] = useState([]); // newest first; seeded from the server below on load/reload

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
    getJson('/admin/api/me').then(({ data }) => setRole(data?.role ?? null));
    loadDetail();
  }, [loadDetail]);

  // While registration is open, keep the entry count and timer fresh.
  const isOpen = detail?.status === 'open';
  useEffect(() => {
    if (!isOpen) return undefined;
    const id = setInterval(loadDetail, 3000);
    return () => clearInterval(id);
  }, [isOpen, loadDetail]);

  // Seeds this session's "sealed"/"winners" state from the server on load (or
  // reload), so refreshing the admin page recovers what was already sealed/
  // drawn instead of showing "not sealed yet" / an empty winners log. Only
  // fires while still empty, so it never clobbers this session's own
  // just-took-that-action state with a slightly-stale poll response.
  useEffect(() => {
    if (!detail) return;
    if (sealed === null && detail.sealed) setSealed(detail.sealed);
    if (winners.length === 0 && detail.recentWinners?.length > 0) setWinners(detail.recentWinners);
  }, [detail]);

  // "Reopen registration" (available from the closed-registration step, as
  // long as nothing's been drawn yet) resets opens_at server-side, which
  // invalidates any earlier seal for this round. Without this, the Lock
  // step's "saved" confirmation would stay stuck on screen from before the
  // reopen, even though the server now correctly requires locking it again.
  useEffect(() => {
    if (detail && detail.status !== 'closed') setSealed(null);
  }, [detail?.status]);

  const derived = detail ? deriveSteps(detail, sealed) : null;

  // When the workflow moves on (e.g. registration closes), follow it.
  useEffect(() => {
    setSelected(null);
  }, [derived?.current]);

  if (detail === undefined) return null;

  if (detail === null) {
    return (
      <div className="page-wide">
        <div className="topbar">
          <a className="back-link" href="/admin">← Back to dashboard</a>
        </div>
        <h1>Raffle</h1>
        <p className="msg error">You don't have access to the raffle area.</p>
      </div>
    );
  }

  const active = selected ?? derived.current;
  const index = STEPS.findIndex((s) => s.key === active);
  const { Component } = STEPS[index];
  const steps = STEPS.map((s) => ({ ...s, ...derived.state[s.key] }));

  const ctx = {
    detail,
    csrfToken,
    canEdit: role === 'raffle_operator',
    reload: loadDetail,
    goTo: setSelected,
    number: index + 1,
    total: STEPS.length,
    drawnCount: derived.drawn,
    sealed,
    setSealed,
    winners,
    addWinner: (w) => setWinners((prev) => [w, ...prev]),
  };

  return (
    <div className="page-wide">
      <div className="topbar">
        <a className="back-link" href="/admin">← Back to dashboard</a>
        <StatusPill status={detail.status} />
      </div>
      <h1>Raffle</h1>
      <CopyScreenLink path={detail.screenPath} />

      <div className="wizard">
        <StepList steps={steps} selected={active} onSelect={setSelected} />
        <div>
          <div className="step-panel" key={active}>
            <Component ctx={ctx} />
          </div>
          {ctx.canEdit && <StartOver detail={detail} csrfToken={csrfToken} onReset={() => { setWinners([]); setSealed(null); loadDetail(); }} />}
        </div>
      </div>
    </div>
  );
}
