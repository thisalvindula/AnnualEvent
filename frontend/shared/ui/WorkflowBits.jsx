import { useEffect, useState } from 'preact/hooks';

// Small pieces shared by the step-by-step admin screens (Raffle, Voting).

export const failure = (res) => res.data?.message ?? `Something went wrong (code ${res.status}). Please try again.`;

export function ViewOnly({ who = 'operator' }) {
  return <p className="callout">View only: only the {who} can do this step.</p>;
}

export function StepHeader({ number, total, title, children }) {
  return (
    <>
      <p className="panel-kicker">Step {number} of {total}</p>
      <h2>{title}</h2>
      {children && <p className="lead">{children}</p>}
    </>
  );
}

// Seconds left in a timed window, ticking locally between polls.
export function useSecondsLeft(serverSeconds) {
  const [left, setLeft] = useState(serverSeconds ?? 0);
  useEffect(() => setLeft(serverSeconds ?? 0), [serverSeconds]);
  useEffect(() => {
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  return left;
}

export function formatClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}
