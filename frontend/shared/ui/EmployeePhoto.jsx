import { useState } from 'preact/hooks';

const EXTENSIONS = ['jpg', 'png'];

function initials(name) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Photos are baked into the image at build time, named "<empId>.jpg" or
// "<empId>.png" (see Dockerfile / app/server.js's /employee-photos/ mount).
// Falls back to an initials avatar when there's no empId, or when neither
// extension loads (photo missing for that employee).
export function EmployeePhoto({ empId, name, size = 'sm' }) {
  const [extIndex, setExtIndex] = useState(0);

  const showFallback = !empId || extIndex >= EXTENSIONS.length;

  if (showFallback) {
    return (
      <div className={`employee-photo employee-photo-${size} employee-photo-fallback`}>
        {initials(name)}
      </div>
    );
  }

  return (
    <img
      className={`employee-photo employee-photo-${size}`}
      src={`/employee-photos/${empId}.${EXTENSIONS[extIndex]}`}
      alt={name || empId}
      onError={() => setExtIndex((i) => i + 1)}
    />
  );
}
