import { useState } from 'preact/hooks';
import { postJson } from '../../shared/csrf.js';

function parseLines(text, tier) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, tier }));
}

export function GiftConfigForm({ csrfToken, giftsConfigured, onSaved }) {
  const [normalGifts, setNormalGifts] = useState('');
  const [premiumGifts, setPremiumGifts] = useState('');
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const gifts = [...parseLines(normalGifts, 'normal'), ...parseLines(premiumGifts, 'premium')];
    const { data } = await postJson('/admin/api/raffle/config', csrfToken, { gifts });
    setResult(data);
    if (data.ok) onSaved?.();
  }

  return (
    <div className="card">
      <h2>1. Gift list (10 normal + 15 premium)</h2>
      <p>Currently configured: <strong>{giftsConfigured ? 'yes' : 'no'}</strong>. Can only be changed while status is "draft".</p>
      <form onSubmit={handleSubmit}>
        <label htmlFor="normalGifts">Normal gifts (one per line, exactly 10)</label>
        <textarea
          id="normalGifts"
          placeholder={'Gift A\nGift B\n...'}
          value={normalGifts}
          onInput={(e) => setNormalGifts(e.currentTarget.value)}
        />
        <label htmlFor="premiumGifts">Premium gifts (one per line, exactly 15)</label>
        <textarea
          id="premiumGifts"
          placeholder={'Gift X\nGift Y\n...'}
          value={premiumGifts}
          onInput={(e) => setPremiumGifts(e.currentTarget.value)}
        />
        <button type="submit">Save gift list</button>
      </form>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
