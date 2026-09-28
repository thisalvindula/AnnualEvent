import { useEffect, useMemo, useState } from 'preact/hooks';
import { getJson } from '../../shared/csrf.js';
import { EmployeePhoto } from '../../shared/ui/EmployeePhoto.jsx';

const TABS = [
  { key: 'employees', label: 'Employees', url: '/admin/api/employees', field: 'employees' },
  { key: 'gifts', label: 'Gifts', url: '/admin/api/raffle/gifts', field: 'gifts' },
  { key: 'finalists', label: 'Finalists', url: '/admin/api/vote/finalists', field: 'finalists' },
];

function EmployeesTable({ rows }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.empId, r.name, r.dept].some((v) => (v ?? '').toLowerCase().includes(q))
    );
  }, [rows, search]);

  return (
    <>
      <input
        type="search"
        placeholder="Search by ID, name or department"
        value={search}
        onInput={(e) => setSearch(e.currentTarget.value)}
      />
      <table>
        <thead>
          <tr><th>Emp ID</th><th>Name</th><th>Dept</th></tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.empId}>
              <td>{r.empId}</td>
              <td>{r.name}</td>
              <td>{r.dept ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && <p>No employees match.</p>}
    </>
  );
}

function GiftsTable({ rows }) {
  return (
    <table>
      <thead>
        <tr><th>Draw #</th><th>Gift</th><th>Tier</th></tr>
      </thead>
      <tbody>
        {rows.map((g) => (
          <tr key={g.id}>
            <td>{g.seq}</td>
            <td>{g.name}</td>
            <td>{g.tier}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FinalistsTable({ rows }) {
  return (
    <table>
      <thead>
        <tr><th>#</th><th></th><th>Name</th><th>Song</th><th>Emp ID</th></tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.id}>
            <td>{f.position}</td>
            <td><EmployeePhoto empId={f.empId} name={f.name} /></td>
            <td>{f.name}</td>
            <td>{f.song ?? '—'}</td>
            <td>{f.empId ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const VIEWS = { employees: EmployeesTable, gifts: GiftsTable, finalists: FinalistsTable };
const EMPTY = {
  employees: 'No employees imported yet.',
  gifts: 'No gifts configured yet.',
  finalists: 'No finalists configured yet.',
};

export function App() {
  const [active, setActive] = useState('employees');
  // key -> { rows } | { error } ; absent while loading
  const [data, setData] = useState({});

  useEffect(() => {
    TABS.forEach(async (tab) => {
      const { status, data: body } = await getJson(tab.url);
      if (status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      setData((prev) => ({
        ...prev,
        [tab.key]: status === 200 ? { rows: body[tab.field] } : { error: `Could not load (HTTP ${status})` },
      }));
    });
  }, []);

  const current = data[active];
  const View = VIEWS[active];

  return (
    <div className="page-wide">
      <div className="topbar">
        <a className="back-link" href="/admin">← Back to dashboard</a>
      </div>
      <h1>Lists</h1>

      <div className="stat-grid">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`stat-tile${active === tab.key ? ' active' : ''}`}
            onClick={() => setActive(tab.key)}
            style={{ textAlign: 'left' }}
          >
            <div className="stat-label">{tab.label}</div>
            <div className="stat-value">{data[tab.key]?.rows ? data[tab.key].rows.length : '—'}</div>
          </button>
        ))}
      </div>

      <div className="card">
        <h2>{TABS.find((t) => t.key === active).label}</h2>
        {!current && <p>Loading…</p>}
        {current?.error && <p className="error">{current.error}</p>}
        {current?.rows && (current.rows.length === 0 ? <p>{EMPTY[active]}</p> : <View rows={current.rows} />)}
      </div>
    </div>
  );
}
