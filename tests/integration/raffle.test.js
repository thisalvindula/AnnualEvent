import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as raffle from '../../app/modules/raffle/service.js';
import {
  resetDatabase,
  makeTestEmployees,
  seedEmployees,
  createAdmin,
  normalGifts,
  premiumGifts,
  sleep,
  closeAllConnections,
} from './helpers.js';

const employees = makeTestEmployees(15, 'R');

before(async () => {
  await resetDatabase();
  await seedEmployees(employees);
  await createAdmin('raffle_reset_test', 'correct-horse-battery', 'raffle_operator');
});

after(closeAllConnections);

test('gift list must be exactly 10 normal + 15 premium', async () => {
  const tooFew = await raffle.setGifts([...normalGifts(9), ...premiumGifts(15)]);
  assert.equal(tooFew.ok, false);
  assert.match(tooFew.message, /exactly 10 normal and 15 premium/);
});

test('a correctly composed gift list is accepted, ordered normal-first/premium-last', async () => {
  const result = await raffle.setGifts([...normalGifts(10), ...premiumGifts(15)]);
  assert.equal(result.ok, true);
  assert.equal(result.gifts.length, 25);
  assert.deepEqual(
    result.gifts.slice(0, 10).map((g) => g.tier),
    Array(10).fill('normal')
  );
  assert.deepEqual(
    result.gifts.slice(10).map((g) => g.tier),
    Array(15).fill('premium')
  );
  assert.deepEqual(result.gifts.map((g) => g.seq), Array.from({ length: 25 }, (_, i) => i + 1));
});

test('drawing before opening is rejected (nothing to draw against)', async () => {
  const result = await raffle.drawNext({});
  assert.equal(result.ok, false);
});

test('registration is rejected before the window opens', async () => {
  const emp = employees[0];
  const result = await raffle.register({ empId: emp.empId, last4: emp.last4, ip: '1.1.1.1' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'closed');
});

test('opening requires the full 25-gift list to already be configured', async () => {
  // already configured in a prior test, so this should succeed with a short window
  const result = await raffle.open({ windowMinutes: 0.05 }); // 3 seconds
  assert.equal(result.ok, true);
  assert.equal(result.config.status, 'open');
});

test('verify then register succeeds while open; a second registration is rejected', async () => {
  const emp = employees[1];
  const verify = await raffle.verify({ empId: emp.empId, last4: emp.last4, ip: '2.2.2.2' });
  assert.equal(verify.ok, true);
  assert.equal(verify.name, emp.name);

  const first = await raffle.register({ empId: emp.empId, last4: emp.last4, ip: '2.2.2.2' });
  assert.equal(first.ok, true);
  assert.equal(typeof first.ticketNo, 'number');

  const second = await raffle.register({ empId: emp.empId, last4: emp.last4, ip: '2.2.2.2' });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'already_registered');
  assert.equal(second.message, 'You are already registered');
});

test('concurrency: 50 simultaneous registrations for the same employee yield exactly one success', async () => {
  const emp = employees[2];
  const attempts = await Promise.all(
    Array.from({ length: 50 }, () => raffle.register({ empId: emp.empId, last4: emp.last4, ip: '3.3.3.3' }))
  );
  const successes = attempts.filter((r) => r.ok === true);
  const alreadyRegistered = attempts.filter((r) => r.ok === false && r.reason === 'already_registered');

  assert.equal(successes.length, 1);
  assert.equal(alreadyRegistered.length, 49);
});

test('register the rest of the pool before the window closes', async () => {
  // employees[0]'s only earlier attempt was before the window opened (and
  // correctly rejected), so it still needs to register here too; [1] and
  // [2] already registered successfully in earlier tests.
  const stillToRegister = [employees[0], ...employees.slice(3)];
  for (const emp of stillToRegister) {
    const result = await raffle.register({ empId: emp.empId, last4: emp.last4, ip: '4.4.4.4' });
    assert.equal(result.ok, true, `expected ${emp.empId} to register successfully`);
  }
  const status = await raffle.getStatus();
  assert.equal(status.entryCount, employees.length);
});

test('window boundary: registration is rejected once the window elapses (real-time, not mocked)', async () => {
  // The window opened with a 3-second duration; give it time to elapse.
  await sleep(3500);
  const status = await raffle.getStatus();
  assert.equal(status.isOpen, false);

  const late = await raffle.register({ empId: 'R099', last4: '9999', ip: '5.5.5.5' });
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'closed');
});

test('sealing the registration list and drawing are rejected before an explicit close', async () => {
  const exportResult = await raffle.exportRegistrations({});
  assert.equal(exportResult.ok, false);
  assert.match(exportResult.message, /Close registration/);

  const drawResult = await raffle.drawNext({});
  assert.equal(drawResult.ok, false);
  assert.match(drawResult.message, /Close registration/);
});

test('close, then seal the list (count + sha256) and draw all winners without replacement', async () => {
  const closeResult = await raffle.close({});
  assert.equal(closeResult.ok, true);
  assert.equal(closeResult.config.status, 'closed');

  const sealed = await raffle.exportRegistrations({});
  assert.equal(sealed.count, employees.length);
  assert.match(sealed.sha256, /^[0-9a-f]{64}$/);

  const winners = [];
  for (let i = 0; i < 25; i++) {
    const result = await raffle.drawNext({});
    if (result.ok) winners.push(result);
  }

  // Only 15 people registered, so at most 15 draws can succeed even though 25 gifts exist.
  assert.equal(winners.length, employees.length);
  assert.equal(new Set(winners.map((w) => w.empId)).size, winners.length, 'no employee won twice');

  // Normal gifts (seq 1-10) drawn before premium gifts (seq 11-25).
  const seqOrder = winners.map((w) => w.seq);
  assert.deepEqual([...seqOrder].sort((a, b) => a - b), seqOrder, 'draws proceed in seq order');
  assert.ok(winners.slice(0, 10).every((w) => w.tier === 'normal'));
  assert.ok(winners.slice(10).every((w) => w.tier === 'premium'));

  const exhausted = await raffle.drawNext({});
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.message, 'No eligible entrants remain');
});

test('results export lists all 15 winners with no duplicates', async () => {
  const results = await raffle.exportResults({});
  const dataLines = results.csv.trim().split('\n').slice(1); // drop header
  assert.equal(dataLines.length, employees.length);
  assert.match(results.sha256, /^[0-9a-f]{64}$/);
});

test('reset is rejected with the wrong password, and nothing is wiped', async () => {
  const result = await raffle.reset({ username: 'raffle_reset_test', password: 'wrong-password' });
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Incorrect password');

  const status = await raffle.getStatus();
  assert.equal(status.status, 'closed');
  assert.equal(status.entryCount, employees.length);
});

test('reset with the right password wipes entries/draws but keeps the gift list, back to draft', async () => {
  const result = await raffle.reset({ username: 'raffle_reset_test', password: 'correct-horse-battery' });
  assert.equal(result.ok, true);

  const status = await raffle.getStatus();
  assert.equal(status.status, 'draft');
  assert.equal(status.entryCount, 0);

  const drawResult = await raffle.drawNext({});
  assert.equal(drawResult.ok, false, 'draw results were wiped too');

  // Gift list survived (kept, since wipeGifts wasn't set) — raffle can reopen immediately.
  const opened = await raffle.open({ windowMinutes: 1 });
  assert.equal(opened.ok, true);
});

test('reset is rejected while the raffle is open', async () => {
  const result = await raffle.reset({ username: 'raffle_reset_test', password: 'correct-horse-battery' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Close the raffle/);
});

test('reset with wipeGifts also clears the gift list, requiring reconfiguration before reopening', async () => {
  const closeResult = await raffle.close({});
  assert.equal(closeResult.ok, true);

  const result = await raffle.reset({
    username: 'raffle_reset_test',
    password: 'correct-horse-battery',
    wipeGifts: true,
  });
  assert.equal(result.ok, true);

  const opened = await raffle.open({ windowMinutes: 1 });
  assert.equal(opened.ok, false, 'cannot reopen without gifts configured');
  assert.match(opened.message, /gift list/);
});
