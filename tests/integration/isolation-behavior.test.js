import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as raffle from '../../app/modules/raffle/service.js';
import * as voting from '../../app/modules/voting/service.js';
import {
  resetDatabase,
  makeTestEmployees,
  seedEmployees,
  seedGifts,
  forceConfigDraft,
  closeAllConnections,
} from './helpers.js';

// Requirement 12: "Isolation: with raffle closed and voting open (and the
// reverse), each module behaves independently." The real config tables are
// one-shot (draft -> open -> closed, no going back — matches a real live
// event happening once), so hitting BOTH literal state combinations in one
// run needs a test-only reset of voting's config partway through (see
// forceConfigDraft in helpers.js). Everything else goes through the real
// service functions, exactly as the app itself would call them.

const employees = makeTestEmployees(4, 'I');
const finalists = [
  { name: 'A', position: 1 },
  { name: 'B', position: 2 },
  { name: 'C', position: 3 },
  { name: 'D', position: 4 },
  { name: 'E', position: 5 },
];

before(async () => {
  await resetDatabase();
  await seedEmployees(employees);
  await seedGifts();
  await voting.setFinalists(finalists);
});

after(closeAllConnections);

test('pair A: raffle open + voting closed — each module unaffected by the other', async () => {
  // Voting: start then immediately close, so it's genuinely 'closed' (not just 'draft').
  const started = await voting.start({});
  assert.equal(started.ok, true);
  const closed = await voting.close({});
  assert.equal(closed.ok, true);
  assert.equal((await voting.getStatus()).status, 'closed');

  // Now open raffle.
  const opened = await raffle.open({ windowMinutes: 5 });
  assert.equal(opened.ok, true);
  assert.equal((await raffle.getStatus()).isOpen, true);

  // Raffle works normally while voting sits closed.
  const emp = employees[0];
  const registered = await raffle.register({ empId: emp.empId, last4: emp.last4, ip: '1.1.1.1' });
  assert.equal(registered.ok, true, 'raffle registration must work while voting is closed');

  // Voting remains closed and unaffected by raffle opening/registering.
  assert.equal((await voting.getStatus()).status, 'closed');
  const votedWhileClosed = await voting.cast({ empId: employees[1].empId, last4: employees[1].last4, finalistId: 1, ip: '1.1.1.2' });
  assert.equal(votedWhileClosed.ok, false);
  assert.equal(votedWhileClosed.reason, 'closed');
});

test('pair B: voting open + raffle closed — each module unaffected by the other', async () => {
  // Close raffle (it was left open by the previous test).
  const raffleClosed = await raffle.close({});
  assert.equal(raffleClosed.ok, true);
  assert.equal((await raffle.getStatus()).status, 'closed');

  // Test-only bypass: put voting back to 'draft' so it can be started again
  // (its config row was consumed by pair A's start->close cycle above).
  await forceConfigDraft('vote_config');
  assert.equal((await voting.getStatus()).status, 'draft');

  const started = await voting.start({});
  assert.equal(started.ok, true);
  assert.equal((await voting.getStatus()).isOpen, true);

  // Voting works normally while raffle sits closed.
  const emp = employees[2];
  const verify = await voting.verify({ empId: emp.empId, last4: emp.last4, ip: '2.2.2.1' });
  assert.equal(verify.ok, true);
  const cast = await voting.cast({ empId: emp.empId, last4: emp.last4, finalistId: verify.finalists[0].id, ip: '2.2.2.1' });
  assert.equal(cast.ok, true, 'voting must work while raffle is closed');

  // Raffle remains closed and unaffected by voting opening/casting.
  assert.equal((await raffle.getStatus()).status, 'closed');
  const registeredWhileClosed = await raffle.register({ empId: employees[3].empId, last4: employees[3].last4, ip: '2.2.2.2' });
  assert.equal(registeredWhileClosed.ok, false);
  assert.equal(registeredWhileClosed.reason, 'closed');
});
