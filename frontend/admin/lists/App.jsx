import { useEffect, useMemo, useState } from 'preact/hooks';
import { fetchCsrfToken, getJson, postJson, putJson, deleteJson } from '../../shared/csrf.js';
import { EmployeePhoto } from '../../shared/ui/EmployeePhoto.jsx';
import { GiftConfigForm } from '../raffle/GiftConfigForm.jsx';

const TABS = [
  { key: 'employees', label: 'Employees', url: '/admin/api/employees', field: 'employees' },
  { key: 'gifts', label: 'Gifts', url: '/admin/api/raffle/gifts', field: 'gifts' },
  { key: 'finalists', label: 'Finalists', url: '/admin/api/vote/finalists', field: 'finalists' },
];

const EMPLOYEE_EDITOR_ROLES = ['raffle_operator', 'vote_operator'];
const GIFT_EDITOR_ROLES = ['raffle_operator'];
const FINALIST_EDITOR_ROLES = ['vote_operator'];

const errorText = (res) => res.data?.message ?? `Request failed (HTTP ${res.status})`;

function EmployeeRow({ employee, csrfToken, canEdit, onChanged, onError }) {
  const [form, setForm] = useState(null); // null = read-only view
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.currentTarget.value }));

  async function save() {
    onError(null);
    const res = await putJson(`/admin/api/employees/${encodeURIComponent(employee.empId)}`, csrfToken, {
      name: form.name.trim(),
      nic: form.nic.trim(),
      imageName: form.imageName.trim() || null,
    });
    if (!res.ok) return onError(errorText(res));
    setForm(null);
    onChanged();
  }

  async function remove() {
    if (!window.confirm(`Delete ${employee.name} (${employee.empId})?`)) return;
    onError(null);
    const res = await deleteJson(`/admin/api/employees/${encodeURIComponent(employee.empId)}`, csrfToken);
    if (!res.ok) return onError(errorText(res));
    onChanged();
  }

  if (!form) {
    return (
      <tr>
        <td><EmployeePhoto imageName={employee.imageName} name={employee.name} /></td>
        <td>{employee.empId}</td>
        <td>{employee.name}</td>
        <td>
          {employee.nic ? (
            <span className="nic">{employee.nic}</span>
          ) : (
            <span className="nic-missing" title="No NIC on file; edit to add one">not on file</span>
          )}
        </td>
        <td>{employee.imageName ?? '—'}</td>
        {canEdit && (
          <td>
            <div className="row-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setForm({ name: employee.name, nic: employee.nic ?? '', imageName: employee.imageName ?? '' })}
              >
                Edit
              </button>
              <button type="button" className="btn-danger" onClick={remove}>Delete</button>
            </div>
          </td>
        )}
      </tr>
    );
  }

  return (
    <tr>
      <td><EmployeePhoto imageName={form.imageName.trim() || null} name={form.name} /></td>
      <td>{employee.empId}</td>
      <td><input value={form.name} onInput={set('name')} aria-label="Name" /></td>
      <td><input value={form.nic} onInput={set('nic')} placeholder="960433149V" aria-label="NIC" /></td>
      <td><input value={form.imageName} onInput={set('imageName')} placeholder="E001.jpg" aria-label="Image name" /></td>
      <td>
        <div className="row-actions">
          <button type="button" onClick={save}>Save</button>
          <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

function AddEmployeeForm({ csrfToken, onChanged, onError }) {
  const [form, setForm] = useState({ empId: '', name: '', nic: '', imageName: '' });
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.currentTarget.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    onError(null);
    const res = await postJson('/admin/api/employees', csrfToken, {
      empId: form.empId.trim(),
      name: form.name.trim(),
      nic: form.nic.trim(),
      imageName: form.imageName.trim() || null,
    });
    if (!res.ok) return onError(errorText(res));
    setForm({ empId: '', name: '', nic: '', imageName: '' });
    onChanged();
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="newEmpId">Employee ID</label>
        <input id="newEmpId" required value={form.empId} onInput={set('empId')} />
      </div>
      <div>
        <label htmlFor="newName">Name</label>
        <input id="newName" required value={form.name} onInput={set('name')} />
      </div>
      <div>
        <label htmlFor="newNic">NIC</label>
        <input id="newNic" required placeholder="960433149V" value={form.nic} onInput={set('nic')} />
      </div>
      <div>
        <label htmlFor="newImage">Image name</label>
        <input id="newImage" placeholder="E001.jpg" value={form.imageName} onInput={set('imageName')} />
      </div>
      <button type="submit">Add employee</button>
    </form>
  );
}

function EmployeesTable({ rows, csrfToken, canEdit, reload }) {
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [r.empId, r.name, r.nic, r.imageName].some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [rows, search]);

  return (
    <>
      {canEdit && <AddEmployeeForm csrfToken={csrfToken} onChanged={reload} onError={setError} />}
      {error && <p className="error">{error}</p>}
      <input
        type="search"
        placeholder="Search by ID, name, NIC or image name"
        value={search}
        onInput={(e) => setSearch(e.currentTarget.value)}
        style={{ marginTop: '1rem' }}
      />
      <div className="table-scroll">
        <table className="edit-table">
          <thead>
            <tr><th></th><th>Emp ID</th><th>Name</th><th>NIC</th><th>Image name</th>{canEdit && <th></th>}</tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <EmployeeRow key={r.empId} employee={r} csrfToken={csrfToken} canEdit={canEdit} onChanged={reload} onError={setError} />
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <p>No employees match.</p>}
      {rows.some((r) => !r.nic) && (
        <p className="hint">
          "Not on file" means the NIC wasn't kept when this employee was added. Re-import the CSV or edit the employee
          to store it; their current NIC still works for registering and voting.
        </p>
      )}
    </>
  );
}

function FinalistRow({ finalist, csrfToken, canEdit, onChanged, onError }) {
  const [form, setForm] = useState(null); // null = read-only view
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.currentTarget.value }));

  async function save() {
    onError(null);
    const res = await putJson(`/admin/api/vote/finalists/${finalist.id}`, csrfToken, {
      name: form.name.trim(),
      song: form.song.trim() || null,
      empId: form.empId.trim() || null,
    });
    if (!res.ok) return onError(errorText(res));
    setForm(null);
    onChanged();
  }

  if (!form) {
    return (
      <tr>
        <td>{finalist.position}</td>
        <td><EmployeePhoto imageName={finalist.imageName} name={finalist.name} /></td>
        <td>{finalist.name}</td>
        <td>{finalist.song ?? '—'}</td>
        <td>{finalist.empId ?? '—'}</td>
        {canEdit && (
          <td>
            <div className="row-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setForm({ name: finalist.name, song: finalist.song ?? '', empId: finalist.empId ?? '' })}
              >
                Edit
              </button>
            </div>
          </td>
        )}
      </tr>
    );
  }

  return (
    <tr>
      <td>{finalist.position}</td>
      <td><EmployeePhoto imageName={finalist.imageName} name={form.name} /></td>
      <td><input value={form.name} onInput={set('name')} aria-label="Name" /></td>
      <td><input value={form.song} onInput={set('song')} placeholder="Song (optional)" aria-label="Song" /></td>
      <td><input value={form.empId} onInput={set('empId')} placeholder="E001 (optional)" aria-label="Employee ID" /></td>
      <td>
        <div className="row-actions">
          <button type="button" onClick={save}>Save</button>
          <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

function FinalistsTable({ rows, csrfToken, canEdit, reload }) {
  const [error, setError] = useState(null);

  return (
    <>
      {error && <p className="msg error">{error}</p>}
      <div className="table-scroll">
        <table className="edit-table">
          <thead>
            <tr><th>#</th><th></th><th>Name</th><th>Song</th><th>Emp ID</th>{canEdit && <th></th>}</tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <FinalistRow key={f.id} finalist={f} csrfToken={csrfToken} canEdit={canEdit} onChanged={reload} onError={setError} />
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <p className="hint">Names, songs and employee links can be changed until voting starts. To replace all five, use the <a href="/admin/vote">Voting admin</a> page.</p>
      ) : (
        <p className="hint">View only: only the vote operator can change the finalists.</p>
      )}
    </>
  );
}

export function App() {
  const [active, setActive] = useState('employees');
  // key -> { rows } | { error } ; absent while loading
  const [data, setData] = useState({});
  const [role, setRole] = useState(null);
  const [csrfToken, setCsrfToken] = useState(null);

  async function load(tab) {
    const { status, data: body } = await getJson(tab.url);
    if (status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    setData((prev) => ({
      ...prev,
      [tab.key]: status === 200 ? { rows: body[tab.field] } : { error: `Could not load (HTTP ${status})` },
    }));
  }

  useEffect(() => {
    TABS.forEach(load);
    getJson('/admin/api/me').then(({ data: me }) => setRole(me?.role ?? null));
    fetchCsrfToken().then(setCsrfToken).catch(() => {});
  }, []);

  const tab = TABS.find((t) => t.key === active);
  const current = data[active];
  const canEditEmployees = EMPLOYEE_EDITOR_ROLES.includes(role);
  const reload = () => load(tab);

  let body = null;
  if (!current) {
    body = <p>Loading…</p>;
  } else if (current.error) {
    body = <p className="error">{current.error}</p>;
  } else if (active === 'employees') {
    body = <EmployeesTable rows={current.rows} csrfToken={csrfToken} canEdit={canEditEmployees} reload={reload} />;
  } else if (active === 'gifts') {
    body = (
      <GiftConfigForm
        csrfToken={csrfToken}
        gifts={current.rows}
        totalPrizes={current.rows.reduce((sum, g) => sum + g.quantity, 0)}
        canEdit={GIFT_EDITOR_ROLES.includes(role)}
        onSaved={reload}
      />
    );
  } else if (current.rows.length === 0) {
    body = <p>No finalists configured yet. Set them up on the <a href="/admin/vote">Voting admin</a> page.</p>;
  } else {
    body = (
      <FinalistsTable
        rows={current.rows}
        csrfToken={csrfToken}
        canEdit={FINALIST_EDITOR_ROLES.includes(role)}
        reload={reload}
      />
    );
  }

  return (
    <div className="page-wide">
      <div className="topbar">
        <a className="back-link" href="/admin">← Back to dashboard</a>
      </div>
      <h1>Lists</h1>

      <div className="stat-grid">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`stat-tile${active === t.key ? ' active' : ''}`}
            onClick={() => setActive(t.key)}
            style={{ textAlign: 'left' }}
          >
            <div className="stat-label">{t.label}</div>
            <div className="stat-value">{data[t.key]?.rows ? data[t.key].rows.length : '—'}</div>
          </button>
        ))}
      </div>

      <div className="card card-wide">
        <h2>{tab.label}</h2>
        {body}
      </div>
    </div>
  );
}
