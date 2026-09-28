export function Message({ text, kind }) {
  if (!text) return null;
  return <div className={`msg ${kind}`}>{text}</div>;
}
