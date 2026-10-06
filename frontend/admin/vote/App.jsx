import { useCallback, useEffect, useState } from 'preact/hooks';
import { fetchCsrfToken, getJson } from '../../shared/csrf.js';
import { CopyScreenLink } from '../../shared/ui/CopyScreenLink.jsx';
import { StatusPill } from '../../shared/ui/StatusPill.jsx';
import { StepList } from '../../shared/ui/StepList.jsx';
import { FinalistsStep, VoteStep, ResultsStep, StartOver } from './Steps.jsx';

const STEPS = [
  { key: 'finalists', title: 'Set up the finalists', Component: FinalistsStep },
  { key: 'vote', title: 'Open voting', Component: VoteStep },
  { key: 'results', title: 'Results', Component: ResultsStep },
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Works out each step's state from what the server says. 'current' is what
// the operator should be doing right now; 'locked' steps can't be opened yet
// (the summary says why).
function deriveSteps(detail) {
  const { status, totalVotes, finalistsConfigured } = detail;

  const state = {
    finalists: finalistsConfigured
      ? { state: 'done', summary: '5 finalists set' }
      : { state: 'current', summary: 'Not set up yet' },
    vote: !finalistsConfigured
      ? { state: 'locked', summary: 'Add the finalists first' }
      : status === 'open'
        ? { state: 'current', summary: `Open · ${plural(totalVotes, 'vote', 'votes')}` }
        : status === 'closed'
          ? { state: 'done', summary: `Closed · ${plural(totalVotes, 'vote', 'votes')}` }
          : { state: 'current', summary: 'Not open yet' },
    results:
      status === 'closed'
        ? { state: 'current', summary: 'Voting complete' }
        : { state: 'locked', summary: 'Available once voting is closed' },
  };

  const current = STEPS.find((s) => state[s.key].state === 'current')?.key ?? 'results';
  return { state, current };
}

export function App() {
  const [csrfToken, setCsrfToken] = useState(null);
  const [detail, setDetail] = useState(undefined); // undefined = loading
  const [role, setRole] = useState(null);
  const [selected, setSelected] = useState(null); // null = follow the current step

  const loadDetail = useCallback(async () => {
    const { status, data } = await getJson('/admin/api/vote/detail');
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

  // While voting is open, keep the vote count and timer fresh.
  const isOpen = detail?.status === 'open';
  useEffect(() => {
    if (!isOpen) return undefined;
    const id = setInterval(loadDetail, 3000);
    return () => clearInterval(id);
  }, [isOpen, loadDetail]);

  const derived = detail ? deriveSteps(detail) : null;

  // When the workflow moves on (e.g. voting closes), follow it.
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
        <h1>Voting</h1>
        <p className="msg error">You don't have access to the voting area.</p>
      </div>
    );
  }

  const active = selected ?? derived.current;
  const index = STEPS.findIndex((s) => s.key === active);
  const { Component } = STEPS[index];
  const steps = STEPS.map((s) => ({ ...s, ...derived.state[s.key] }));
  const canEdit = role === 'vote_operator';

  const ctx = {
    detail,
    csrfToken,
    canEdit,
    isAuditor: role === 'auditor',
    reload: loadDetail,
    goTo: setSelected,
    number: index + 1,
    total: STEPS.length,
  };

  return (
    <div className="page-wide">
      <div className="topbar">
        <a className="back-link" href="/admin">← Back to dashboard</a>
        <StatusPill status={detail.status} />
      </div>
      <h1>Voting</h1>
      <CopyScreenLink path={detail.screenPath} />

      <div className="wizard">
        <StepList steps={steps} selected={active} onSelect={setSelected} />
        <div>
          <div className="step-panel" key={active}>
            <Component ctx={ctx} />
          </div>
          {canEdit && <StartOver detail={detail} csrfToken={csrfToken} onReset={loadDetail} />}
        </div>
      </div>
    </div>
  );
}
