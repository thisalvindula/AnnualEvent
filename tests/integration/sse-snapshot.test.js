// Regression guard for the big screens' "resume after a reload" behavior:
// both /screen/raffle/stream and /screen/vote/stream must push a full state
// snapshot the instant a screen connects, so reconnecting (a page reload, or
// the browser's own EventSource auto-reconnect after a server restart) never
// leaves the audience looking at stale/empty content. Needs a real listening
// server (not app.inject()) since SSE requires an actual streamed response.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../app/buildApp.js';
import { config } from '../../app/core/config.js';
import * as raffle from '../../app/modules/raffle/service.js';
import * as voting from '../../app/modules/voting/service.js';
import { resetDatabase, makeTestEmployees, seedEmployees, seedGifts, closeAllConnections } from './helpers.js';

let app;
let baseUrl;

before(async () => {
  await resetDatabase();
  app = await buildApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.close();
  await closeAllConnections();
});

/** Reads an SSE stream until `eventName` arrives, parses its data, and cancels the connection. */
async function readSnapshot(path, eventName, timeoutMs = 4000) {
  const res = await fetch(`${baseUrl}${path}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const timer = setTimeout(() => reader.cancel(), timeoutMs);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`stream closed before "${eventName}" arrived`);
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(new RegExp(`event: ${eventName}\\ndata: (.+)\\n`));
      if (match) return JSON.parse(match[1]);
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
}

test('raffle screen stream sends a resume snapshot (recent winners + seal) on connect', async () => {
  const employees = makeTestEmployees(5, 'S');
  await seedEmployees(employees);
  await seedGifts(); // ids 1 (x1), 2 (x1), 10 (x20)

  await raffle.open({ windowMinutes: 1 });
  for (const emp of employees.slice(0, 2)) {
    const result = await raffle.register({ empId: emp.empId, last4: emp.last4 });
    assert.equal(result.ok, true, `seed registration failed: ${JSON.stringify(result)}`);
  }
  await raffle.close();

  const sealResult = await raffle.exportRegistrations();
  assert.equal('sha256' in sealResult, true);

  const first = await raffle.drawNext(); // gift 1
  const second = await raffle.drawNext(); // gift 2
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const snapshot = await readSnapshot(`/screen/raffle/stream?token=${config.screenTokens.raffle}`, 'snapshot');

  assert.equal(snapshot.totalPrizes, 22); // 1 + 1 + 20
  assert.equal(snapshot.drawnCount, 2);
  assert.equal(snapshot.recentWinners.length, 2);
  // Newest first: the second draw (gift 2) resolves before the first (gift 1).
  assert.equal(snapshot.recentWinners[0].giftId, 2);
  assert.equal(snapshot.recentWinners[1].giftId, 1);
  assert.equal(snapshot.sealed.sha256, sealResult.sha256);
});

test('voting screen stream still sends the live tally as its resume snapshot on connect', async () => {
  await resetDatabase();
  const employees = makeTestEmployees(6, 'V');
  await seedEmployees(employees);

  const finalists = [1, 2, 3, 4, 5].map((position) => ({ name: `Finalist ${position}`, song: null, position }));
  const setResult = await voting.setFinalists(finalists);
  assert.equal(setResult.ok, true, `seed finalists failed: ${JSON.stringify(setResult)}`);

  await voting.start({});
  const voter = employees[0];
  const { tally: startingTally } = await voting.getTally();
  const castResult = await voting.cast({ empId: voter.empId, last4: voter.last4, finalistId: startingTally[0].id });
  assert.equal(castResult.ok, true, `seed vote failed: ${JSON.stringify(castResult)}`);

  const snapshot = await readSnapshot(`/screen/vote/stream?token=${config.screenTokens.vote}`, 'tally');

  assert.equal(snapshot.totalVotes, 1);
  assert.equal(
    snapshot.tally.reduce((sum, f) => sum + f.votes, 0),
    1
  );
});
