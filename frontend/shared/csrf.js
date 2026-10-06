// Admin-only CSRF helpers. Employee pages (raffle/register, voting/vote)
// never import this — their POST endpoints aren't behind app.csrfProtection.

export async function fetchCsrfToken() {
  const res = await fetch('/admin/api/csrf', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('failed to fetch csrf token');
  const { csrfToken } = await res.json();
  return csrfToken;
}

async function sendJson(method, url, csrfToken, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

export const postJson = (url, csrfToken, body) => sendJson('POST', url, csrfToken, body);
export const putJson = (url, csrfToken, body) => sendJson('PUT', url, csrfToken, body);

// No request body: fastify rejects an empty body sent with a JSON content-type.
export async function deleteJson(url, csrfToken) {
  const res = await fetch(url, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'x-csrf-token': csrfToken },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

export async function getJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}
