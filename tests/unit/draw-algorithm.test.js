import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';

// The actual draw (app/modules/raffle/service.js drawNext) needs a live
// database, so its end-to-end behavior is covered in
// tests/integration/raffle.test.js. This file tests the same
// draw-without-replacement algorithm in isolation — repeatedly picking a
// random index from a shrinking pool via crypto.randomInt, exactly like
// drawNext does against the DB-backed eligible list — plus a static check
// that the real implementation never uses Math.random (requirement 9.3).

function drawAllWithoutReplacement(pool) {
  const remaining = [...pool];
  const drawn = [];
  while (remaining.length > 0) {
    const index = randomInt(0, remaining.length);
    drawn.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return drawn;
}

test('drawing an entire pool without replacement yields every member exactly once', () => {
  const pool = Array.from({ length: 40 }, (_, i) => `E${i}`);
  const drawn = drawAllWithoutReplacement(pool);

  assert.equal(drawn.length, pool.length);
  assert.equal(new Set(drawn).size, pool.length, 'no duplicates');
  assert.deepEqual([...drawn].sort(), [...pool].sort(), 'every entrant appears exactly once');
});

test('repeated draws are not a fixed/predictable order (sanity, not a strict fairness proof)', () => {
  const pool = Array.from({ length: 25 }, (_, i) => `E${i}`);
  const first = drawAllWithoutReplacement(pool).join(',');
  const second = drawAllWithoutReplacement(pool).join(',');
  // Astronomically unlikely to collide for a 25-item random permutation if
  // randomInt is actually doing its job.
  assert.notEqual(first, second);
});

test('drawing from an empty pool yields nothing (mirrors "no eligible entrants" case)', () => {
  assert.deepEqual(drawAllWithoutReplacement([]), []);
});

test('raffle service uses crypto.randomInt for the draw, never Math.random', () => {
  const serviceSource = readFileSync(
    fileURLToPath(new URL('../../app/modules/raffle/service.js', import.meta.url)),
    'utf8'
  );
  assert.match(serviceSource, /randomInt\(/, 'expected drawNext to call crypto.randomInt');
  // Match an actual call, not the word "Math.random" inside an explanatory comment.
  assert.doesNotMatch(serviceSource, /Math\.random\(/, 'must never use Math.random for the draw');
});
