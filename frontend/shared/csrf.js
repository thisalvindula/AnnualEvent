// Admin-only CSRF helpers. Employee pages (raffle/register, voting/vote)
// never import this — their POST endpoints aren't behind app.csrfProtection.

export async function fetchCsrfToken() {
  const res = await fetch('/admin/api/csrf', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('failed to fetch csrf token');
  const { csrfToken } = await res.json();
  return csrfToken;
}

export async function postJson(url, csrfToken, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

export async function getJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}
