import { useEffect, useState } from 'preact/hooks';
import { fetchCsrfToken } from '../../shared/csrf.js';

export function App() {
  const [csrfToken, setCsrfToken] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => new URLSearchParams(location.search).get('error'));
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchCsrfToken()
      .then(setCsrfToken)
      .catch(() => setError('Could not reach the server. Try again.'));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!csrfToken || submitting) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      window.location.href = '/admin';
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(body.message || 'Login failed');
    setSubmitting(false);
  }

  return (
    <div className="page login-wrap">
      <div className="card login-card">
        <div className="brand">
          <span className="mark" />
          <span className="name">Annual Event</span>
        </div>
        <h1>Admin Login</h1>
        {error && <p className="error">{error}</p>}
        <form onSubmit={handleSubmit}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            required
            autoComplete="username"
            value={username}
            onInput={(e) => setUsername(e.currentTarget.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
          <button type="submit" disabled={submitting || !csrfToken}>Log in</button>
        </form>
      </div>
    </div>
  );
}
