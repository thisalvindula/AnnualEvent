import { useState } from 'preact/hooks';
import { postJson, putJson, deleteJson } from '../../shared/csrf.js';

const toPayload = (f) => ({
  id: Number(f.id),
  place: f.place.trim(),
  quantity: Number(f.quantity),
  description: f.description.trim(),
  section: f.section,
});

const toForm = (g) => ({ id: String(g.id), place: g.place, quantity: String(g.quantity), description: g.description, section: g.section });

const SECTION_LABEL = { podium: 'Podium', consolation: 'Consolation row' };

function SectionSelect({ value, onChange, id }) {
  return (
    <select id={id} value={value} onChange={onChange} aria-label="Screen section">
      <option value="podium">Podium (1 winner)</option>
      <option value="consolation">Consolation row</option>
    </select>
  );
}

function errorText(res) {
  return res.data?.message ?? `Request failed (HTTP ${res.status})`;
}

function GiftRow({ gift, csrfToken, canEdit, onChanged, onError }) {
  const [form, setForm] = useState(null); // null = read-only view
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.currentTarget.value }));

  async function save() {
    onError(null);
    const res = await putJson(`/admin/api/raffle/gifts/${gift.id}`, csrfToken, toPayload(form));
    if (!res.ok) return onError(errorText(res));
    setForm(null);
    onChanged();
  }

  async function remove() {
    if (!window.confirm(`Delete the prize "${gift.place}"? This can't be undone.`)) return;
    onError(null);
    const res = await deleteJson(`/admin/api/raffle/gifts/${gift.id}`, csrfToken);
    if (!res.ok) return onError(errorText(res));
    onChanged();
  }

  if (!form) {
    return (
      <tr>
        <td>{gift.id}</td>
        <td>{gift.place}</td>
        <td>{gift.quantity}</td>
        <td>{gift.description}</td>
        <td>{SECTION_LABEL[gift.section]}</td>
        <td>{gift.drawn} / {gift.quantity}</td>
        {canEdit && (
          <td>
            <div className="row-actions">
              <button type="button" className="btn-secondary" onClick={() => setForm(toForm(gift))}>Edit</button>
              <button type="button" className="btn-danger" onClick={remove}>Delete</button>
            </div>
          </td>
        )}
      </tr>
    );
  }

  return (
    <tr>
      <td><input type="number" min="1" value={form.id} onInput={set('id')} aria-label="Draw order" /></td>
      <td><input value={form.place} onInput={set('place')} aria-label="Place" /></td>
      <td><input type="number" min={Math.max(1, gift.drawn)} value={form.quantity} onInput={set('quantity')} aria-label="Quantity" /></td>
      <td><input value={form.description} onInput={set('description')} aria-label="Description" /></td>
      <td><SectionSelect value={form.section} onChange={set('section')} /></td>
      <td>{gift.drawn} / {gift.quantity}</td>
      <td>
        <div className="row-actions">
          <button type="button" onClick={save}>Save</button>
          <button type="button" className="btn-secondary" onClick={() => setForm(null)}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

function AddGiftForm({ csrfToken, nextId, onChanged, onError }) {
  const [form, setForm] = useState(null);
  const current = form ?? { id: String(nextId), place: '', quantity: '1', description: '', section: 'podium' };
  const set = (key) => (e) => setForm({ ...current, [key]: e.currentTarget.value });

  async function handleSubmit(e) {
    e.preventDefault();
    onError(null);
    const res = await postJson('/admin/api/raffle/gifts', csrfToken, toPayload(current));
    if (!res.ok) return onError(errorText(res));
    setForm(null);
    onChanged();
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <div>
        <label htmlFor="giftId">Draw order</label>
        <input id="giftId" type="number" min="1" required value={current.id} onInput={set('id')} />
      </div>
      <div>
        <label htmlFor="giftPlace">Place</label>
        <input id="giftPlace" required placeholder="1st place" value={current.place} onInput={set('place')} />
      </div>
      <div>
        <label htmlFor="giftQty">Quantity</label>
        <input id="giftQty" type="number" min="1" required value={current.quantity} onInput={set('quantity')} />
      </div>
      <div>
        <label htmlFor="giftSection">Screen section</label>
        <SectionSelect id="giftSection" value={current.section} onChange={set('section')} />
      </div>
      <div className="wide">
        <label htmlFor="giftDesc">Description</label>
        <input id="giftDesc" required placeholder="Cash 100000" value={current.description} onInput={set('description')} />
      </div>
      <button type="submit">Add gift</button>
    </form>
  );
}

export function GiftConfigForm({ csrfToken, gifts, totalPrizes, canEdit, onSaved }) {
  const [error, setError] = useState(null);
  const nextId = gifts.reduce((max, g) => Math.max(max, g.id), 0) + 1;

  return (
    <div>
      <p className="lead">
        Add each prize below. Winners are drawn in <strong>draw order</strong> (1 first, then 2, and so on), and each
        prize is drawn as many times as its <strong>quantity</strong>. You can fix mistakes at any time; a prize that
        already has winners can't be deleted or reduced below the winners drawn. <strong>Screen section</strong> sets where a prize
        appears on the big screen: podium prizes (one winner each) are laid out from the top, lowest draw order first;
        consolation prizes go in the bottom row.
      </p>

      {gifts.length === 0 ? (
        <p className="callout">No prizes yet — add the first one below.</p>
      ) : (
        <>
          <p><strong>{gifts.length}</strong> prize{gifts.length === 1 ? '' : 's'}, <strong>{totalPrizes}</strong> winner{totalPrizes === 1 ? '' : 's'} in total.</p>
          <div className="table-scroll">
            <table className="edit-table">
              <thead>
                <tr>
                  <th>Draw order</th><th>Place</th><th>Quantity</th><th>Description</th><th>Screen section</th><th>Drawn</th>{canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {gifts.map((g) => (
                  <GiftRow key={g.id} gift={g} csrfToken={csrfToken} canEdit={canEdit} onChanged={onSaved} onError={setError} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {error && <p className="msg error">{error}</p>}
      {canEdit ? (
        <>
          <h3>Add a prize</h3>
          <AddGiftForm csrfToken={csrfToken} nextId={nextId} onChanged={onSaved} onError={setError} />
        </>
      ) : (
        <p className="callout">View only: only the raffle operator can change the prizes.</p>
      )}
    </div>
  );
}
