import { useState } from 'preact/hooks';

const TEMPLATE = 'emp_id,name,nic,image_name\nE001,Jane Perera,901234567V,E001.jpg\n';
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;

// Inline employee CSV import. Shows a plain summary and, if some rows were
// rejected, exactly which rows and why.
export function ImportBox({ csrfToken, onImported, onClose }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const file = e.currentTarget.elements.csvFile.files[0];
    if (!file || !csrfToken) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/admin/api/employees/import', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'text/csv', 'x-csrf-token': csrfToken },
        body: await file.text(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.message ?? 'The file could not be imported. Please check it and try again.');
      else {
        setResult(body);
        onImported?.();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-box">
      <p className="step-num">
        Choose a CSV file with the columns <strong>emp_id, name, nic, image_name</strong> (the photo file name is
        optional, e.g. <code>E001.jpg</code>). Employees who are already in the list are updated.{' '}
        <a href={TEMPLATE_HREF} download="employees-template.csv">Download an example file</a>
      </p>
      <form onSubmit={handleSubmit}>
        <input name="csvFile" type="file" accept=".csv,text/csv" required />
        <div className="actions">
          <button type="submit" disabled={busy}>{busy ? 'Importing…' : 'Import employees'}</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </form>
      {error && <p className="msg error">{error}</p>}
      {result && (
        <div className={`callout ${result.errors.length ? 'warn' : 'success'}`}>
          ✓ {result.imported} employee{result.imported === 1 ? '' : 's'} imported.
          {result.errors.length > 0 && (
            <>
              {' '}{result.errors.length} row{result.errors.length === 1 ? ' was' : 's were'} skipped:
              <ul>
                {result.errors.slice(0, 20).map((err, i) => (
                  <li key={i}>
                    {err.row ? `Row ${err.row}` : err.empId}: {err.reason}
                  </li>
                ))}
                {result.errors.length > 20 && <li>…and {result.errors.length - 20} more</li>}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
