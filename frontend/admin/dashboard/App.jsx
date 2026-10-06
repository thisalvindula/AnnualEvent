import { useCallback, useEffect, useState } from 'preact/hooks';
import { fetchCsrfToken, getJson } from '../../shared/csrf.js';
import { ClearDatabaseCard } from './ClearDatabaseCard.jsx';
import { ImportBox } from './ImportBox.jsx';
import { QrCodesCard } from './QrCodesCard.jsx';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// null when the request isn't allowed for this role (or failed).
async function fetchOrNull(url) {
  const { ok, data } = await getJson(url);
  return ok ? data : null;
}

export function App() {
  const [me, setMe] = useState(undefined); // undefined = loading
  const [csrfToken, setCsrfToken] = useState(null);
  const [info, setInfo] = useState(null);
  const [showImport, setShowImport] = useState(false);

  const refresh = useCallback(async () => {
    const [employees, gifts, finalists, raffle, vote] = await Promise.all([
      fetchOrNull('/admin/api/employees'),
      fetchOrNull('/admin/api/raffle/gifts'),
      fetchOrNull('/admin/api/vote/finalists'),
      fetchOrNull('/admin/api/raffle/detail'),
      fetchOrNull('/admin/api/vote/detail'),
    ]);
    setInfo({ employees, gifts, finalists, raffle, vote });
  }, []);

  useEffect(() => {
    getJson('/admin/api/me').then(({ status, data }) => {
      if (status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      setMe(data);
    });
    fetchCsrfToken().then(setCsrfToken).catch(() => {});
    refresh();
  }, [refresh]);

  async function handleLogout(e) {
    e.preventDefault();
    if (!csrfToken) return;
    await fetch('/admin/logout', { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
    window.location.href = '/admin/login';
  }

  if (me === undefined || info === null) return null;

  const role = me.role;
  const canEditEmployees = role === 'raffle_operator' || role === 'vote_operator';
  const isAuditor = role === 'auditor';

  const employeeCount = info.employees?.count ?? 0;
  const giftCount = info.gifts?.count ?? 0;
  const finalistCount = info.finalists?.count ?? 0;
  const raffle = info.raffle;
  const vote = info.vote;
  const raffleDrawn = raffle ? raffle.gifts.reduce((sum, g) => sum + g.drawn, 0) : 0;

  const employeesDone = employeeCount > 0;
  const prizesDone = giftCount > 0;
  const finalistsDone = finalistCount === 5;

  // ---- rows of the checklist -------------------------------------------------
  const prepare = [
    {
      key: 'employees',
      title: 'Employee list',
      desc: employeesDone ? `${plural(employeeCount, 'employee', 'employees')} loaded` : 'Load the list of employees who can take part',
      state: employeesDone ? 'done' : 'current',
      action: canEditEmployees
        ? { label: employeesDone ? 'Import more' : 'Import employees', onClick: () => setShowImport((v) => !v) }
        : { label: 'View list', href: '/admin/lists' },
      secondary: employeesDone && canEditEmployees ? { label: 'View or edit', href: '/admin/lists' } : null,
    },
    {
      key: 'prizes',
      title: 'Raffle prizes',
      desc: prizesDone ? `${plural(giftCount, 'prize', 'prizes')}, ${plural(info.gifts.totalPrizes, 'winner', 'winners')} in total` : 'Add the prizes that will be drawn',
      state: prizesDone ? 'done' : employeesDone ? 'current' : 'todo',
      action: { label: prizesDone ? 'Review prizes' : 'Set up prizes', href: raffle ? '/admin/raffle' : '/admin/lists' },
    },
    {
      key: 'finalists',
      title: 'Voting finalists',
      desc: finalistsDone ? 'All 5 finalists chosen' : `${finalistCount} of 5 finalists chosen`,
      state: finalistsDone ? 'done' : employeesDone ? 'current' : 'todo',
      action: { label: finalistsDone ? 'Review finalists' : 'Choose finalists', href: vote ? '/admin/vote' : '/admin/lists' },
    },
  ];

  const raffleRow = raffle && {
    key: 'raffle',
    title: 'Run the raffle',
    desc:
      raffle.status === 'open'
        ? `Registration is open · ${plural(raffle.entryCount, 'employee', 'employees')} entered`
        : raffle.status === 'closed'
          ? raffleDrawn >= raffle.totalPrizes && raffle.totalPrizes > 0
            ? `Finished · ${plural(raffleDrawn, 'winner', 'winners')} drawn`
            : `Registration closed · ${raffleDrawn} of ${raffle.totalPrizes} winners drawn`
          : 'Open registration, then draw the winners',
    state:
      raffle.status === 'closed' && raffle.totalPrizes > 0 && raffleDrawn >= raffle.totalPrizes
        ? 'done'
        : !prizesDone
          ? 'locked'
          : 'current',
    lockedText: 'Set up the prizes first',
    action: { label: raffle.status === 'draft' ? 'Start the raffle' : isAuditor ? 'View raffle' : 'Go to the raffle', href: '/admin/raffle' },
  };

  const voteRow = vote && {
    key: 'vote',
    title: 'Run the voting',
    desc:
      vote.status === 'open'
        ? `Voting is open · ${plural(vote.totalVotes, 'vote', 'votes')} so far`
        : vote.status === 'closed'
          ? `Finished · ${plural(vote.totalVotes, 'vote', 'votes')} cast`
          : 'Start voting, then close it to see the winner',
    state: vote.status === 'closed' ? 'done' : !finalistsDone ? 'locked' : 'current',
    lockedText: 'Choose the 5 finalists first',
    action: { label: vote.status === 'draft' ? 'Start the voting' : isAuditor ? 'View voting' : 'Go to the voting', href: '/admin/vote' },
  };

  const after = [
    (raffle || isAuditor) && { key: 'raffle-csv', title: 'Raffle winners', desc: 'Download the list of winners (CSV)', href: '/admin/api/raffle/results/export' },
    isAuditor && { key: 'vote-csv', title: 'Voting results', desc: 'Download every vote (CSV)', href: '/admin/api/vote/results/export' },
    isAuditor && { key: 'audit', title: 'Activity log', desc: 'Download the full record of who did what (CSV)', href: '/admin/api/audit/export' },
  ].filter(Boolean);

  const eventRows = [raffleRow, voteRow].filter(Boolean);
  const all = [...prepare, ...eventRows];
  // Auditors are read-only, so nothing is "their turn".
  if (isAuditor) all.forEach((r) => { if (r.state === 'current') r.state = 'todo'; });
  const next = all.find((r) => r.state === 'current');

  function Row({ row, number }) {
    const locked = row.state === 'locked';
    return (
      <div className="check-row" data-state={row.state}>
        <span className="step-badge">{row.state === 'done' ? '✓' : number}</span>
        <div className="step-text">
          <span className="step-title">{row.title}</span>
          <span className="step-sub">{locked ? row.lockedText : row.desc}</span>
        </div>
        {!locked && row.secondary && <a className="btn btn-secondary" href={row.secondary.href}>{row.secondary.label}</a>}
        {!locked && row.action.href && (
          <a className={`btn${row.state === 'current' ? '' : ' btn-secondary'}`} href={row.action.href}>{row.action.label}</a>
        )}
        {!locked && row.action.onClick && (
          <button type="button" className={row.state === 'current' ? '' : 'btn-secondary'} onClick={row.action.onClick}>
            {row.action.label}
          </button>
        )}
      </div>
    );
  }

  let n = 0;

  return (
    <div className="page-wide">
      <div className="topbar">
        <div className="brand" style={{ marginBottom: 0 }}>
          <span className="mark" />
          <span className="name">Annual Event Admin</span>
        </div>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--muted)' }}>
          Signed in as <strong style={{ color: 'var(--navy-900)' }}>{me.username}</strong>
          {' — '}
          <a href="#" onClick={handleLogout}>Sign out</a>
        </p>
      </div>
      <h1>Event checklist</h1>

      <div className="next-banner">
        <div>
          <div className="kicker">{next ? 'Your next step' : 'All done'}</div>
          <div className="title">{next ? next.title : 'Everything on the checklist is finished 🎉'}</div>
          <div className="desc">{next ? next.desc : 'You can download the results below.'}</div>
        </div>
        {next?.action.href && <a className="btn" href={next.action.href}>{next.action.label} →</a>}
        {next?.action.onClick && (
          <button type="button" className="btn" onClick={next.action.onClick}>{next.action.label} →</button>
        )}
      </div>

      <div className="phase">
        <h2>Before the event</h2>
        {prepare.map((row) => <Row key={row.key} row={row} number={++n} />)}
        {showImport && canEditEmployees && (
          <ImportBox csrfToken={csrfToken} onImported={refresh} onClose={() => setShowImport(false)} />
        )}
      </div>

      {eventRows.length > 0 && (
        <div className="phase">
          <h2>On the day</h2>
          {eventRows.map((row) => <Row key={row.key} row={row} number={++n} />)}
        </div>
      )}

      {after.length > 0 && (
        <div className="phase">
          <h2>After the event</h2>
          {after.map((row) => (
            <div className="check-row" key={row.key}>
              <div className="step-text">
                <span className="step-title">{row.title}</span>
                <span className="step-sub">{row.desc}</span>
              </div>
              <a className="btn btn-secondary" href={row.href}>Download</a>
            </div>
          ))}
        </div>
      )}

      <div className="phase">
        <h2>Event QR codes</h2>
        <QrCodesCard />
      </div>

      <div className="phase">
        <h2>More</h2>
        <div className="check-row">
          <div className="step-text">
            <span className="step-title">Employees, prizes and finalists</span>
            <span className="step-sub">Browse and edit the full lists</span>
          </div>
          <a className="btn btn-secondary" href="/admin/lists">Open lists</a>
        </div>
        <ClearDatabaseCard
          csrfToken={csrfToken}
          raffleStatus={raffle?.status}
          voteStatus={vote?.status}
          onCleared={refresh}
        />
      </div>
    </div>
  );
}
