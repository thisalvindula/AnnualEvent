import { useEffect, useState } from 'preact/hooks';

function initials(name) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Photos live in employee-photos/ (baked into the image at build time, see
// Dockerfile / app/server.js's /employee-photos/ mount); each employee record
// stores the exact file name (imageName, e.g. "E001.jpg"). Falls back to an
// initials avatar when there's no imageName or the file doesn't load.
export function EmployeePhoto({ imageName, name, size = 'sm' }) {
  const [failed, setFailed] = useState(false);

  // A different file name (e.g. after an edit) deserves a fresh attempt.
  useEffect(() => setFailed(false), [imageName]);

  if (!imageName || failed) {
    return (
      <div className={`employee-photo employee-photo-${size} employee-photo-fallback`}>
        {initials(name)}
      </div>
    );
  }

  return (
    <img
      className={`employee-photo employee-photo-${size}`}
      src={`/employee-photos/${encodeURIComponent(imageName)}`}
      alt={name || imageName}
      onError={() => setFailed(true)}
    />
  );
}
