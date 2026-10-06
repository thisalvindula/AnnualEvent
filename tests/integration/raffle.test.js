import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as raffle from '../../app/modules/raffle/service.js';
import * as raffleRepo from '../../app/modules/raffle/repo.js';
import {
  resetDatabase,
  makeTestEmployees,
  seedEmployees,
  createAdmin,
  seedGifts,
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

test('opening is rejected until at least one gift is configured', async () => {
  const result = await raffle.open({ windowMinutes: 1 });
  assert.equal(result.ok, false);
  assert.match(result.message, /gift list/);
});

test('gift input is validated', async () => {
  const good = { id: 50, place: '1st place', quantity: 1, description: 'Cash 100000' };
  for (const bad of [
    { ...good, id: 0 },
    { ...good, place: '   ' },
    { ...good, quantity: 0 },
    { ...good, quantity: 1.5 },
    { ...good, description: '' },
  ]) {
    const result = await raffle.createGift(bad);
    assert.equal(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  assert.equal((await raffleRepo.getGifts()).length, 0, 'nothing was saved');
});

test('gifts are listed in ascending id order regardless of the order they were added', async () => {
  await seedGifts(); // ids 1, 2, 10 (see helpers.defaultGifts)
  const gifts = await raffleRepo.getGifts();
  assert.deepEqual(gifts.map((g) => g.id), [1, 2, 10]);
  assert.deepEqual(gifts.map((g) => g.quantity), [1, 1, 20]);
  assert.equal(gifts[2].place, 'Consolation Prize');

  const duplicate = await raffle.createGift({ id: 2, place: 'x', quantity: 1, description: 'x' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'exists');
});

test('a gift can be edited (including its id) and deleted before any draw', async () => {
  await raffle.createGift({ id: 99, place: 'Temp', quantity: 2, description: 'temporary' });

  const edited = await raffle.updateGift(99, { id: 98, place: 'Temp 2', quantity: 5, description: 'changed' });
  assert.equal(edited.ok, true);
  assert.deepEqual(
    { id: edited.gift.id, place: edited.gift.place, quantity: edited.gift.quantity, description: edited.gift.description },
    { id: 98, place: 'Temp 2', quantity: 5, description: 'changed' }
  );
  assert.equal(await raffleRepo.getGift(99), null, 'old id is gone');

  const clash = await raffle.updateGift(98, { id: 1 });
  assert.equal(clash.ok, false);
  assert.equal(clash.reason, 'exists');

  const missing = await raffle.updateGift(12345, { place: 'nope' });
  assert.equal(missing.reason, 'not_found');

  assert.equal((await raffle.deleteGift(98)).ok, true);
  assert.equal((await raffle.deleteGift(98)).reason, 'not_found');
  assert.equal((await raffleRepo.getGifts()).length, 3);
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

test('opening succeeds once gifts are configured', async () => {
  // configured in a prior test, so this should succeed with a short window
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

test('close, then seal the list (count + sha256) and draw winners in gift-id order, honouring quantities', async () => {
  const closeResult = await raffle.close({});
  assert.equal(closeResult.ok, true);
  assert.equal(closeResult.config.status, 'closed');

  const sealed = await raffle.exportRegistrations({});
  assert.equal(sealed.count, employees.length);
  assert.match(sealed.sha256, /^[0-9a-f]{64}$/);

  // Gifts: id 1 (x1), id 2 (x1), id 10 (x20) = 22 prizes, but only 15 people registered.
  const first = await raffle.drawNext({});
  assert.equal(first.ok, true);
  assert.equal(first.giftId, 1);
  assert.equal(first.place, '1st place');
  assert.equal(first.description, 'Cash 100000');
  assert.equal(first.totalPrizes, 22);
  assert.equal(first.remaining, 21);

  const second = await raffle.drawNext({});
  assert.equal(second.giftId, 2);

  const consolation = [];
  for (let i = 0; i < 3; i++) consolation.push(await raffle.drawNext({}));
  assert.ok(consolation.every((w) => w.ok && w.giftId === 10));
  assert.deepEqual(consolation.map((w) => w.slot), [1, 2, 3], 'multi-winner gift fills slots 1..n');
  assert.equal(consolation[2].remaining, 17);
});

test('gifts stay editable mid-draw, but winners already drawn are protected', async () => {
  // Fix a typo on a gift that already has a winner.
  const renamed = await raffle.updateGift(1, { description: 'Cash 150000' });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.gift.description, 'Cash 150000');
  assert.equal(renamed.gift.drawn, 1);

  const deleted = await raffle.deleteGift(1);
  assert.equal(deleted.ok, false);
  assert.equal(deleted.reason, 'in_use');

  // Gift 10 has 3 winners drawn: can't shrink below that, but can shrink to it or grow.
  const tooSmall = await raffle.updateGift(10, { quantity: 2 });
  assert.equal(tooSmall.ok, false);
  assert.match(tooSmall.message, /already been drawn/);
  assert.equal((await raffle.updateGift(10, { quantity: 20 })).ok, true);

  // Winners follow a gift when its id changes.
  const moved = await raffle.updateGift(2, { id: 3 });
  assert.equal(moved.ok, true);
  assert.equal(moved.gift.drawn, 1);
  assert.equal(await raffleRepo.getGift(2), null);
});

test('drawing continues until entrants run out, never repeating a winner', async () => {
  const winners = [];
  for (let i = 0; i < 25; i++) {
    const result = await raffle.drawNext({});
    if (result.ok) winners.push(result);
  }

  // 5 drawn earlier + 10 here = all 15 registrants; every later draw is gift 10.
  assert.equal(winners.length, employees.length - 5);
  assert.ok(winners.every((w) => w.giftId === 10));
  assert.deepEqual(winners.map((w) => w.slot), Array.from({ length: 10 }, (_, i) => i + 4));

  const exhausted = await raffle.drawNext({});
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.message, 'No eligible entrants remain');
});

test('results export lists all 15 winners with no duplicates', async () => {
  const results = await raffle.exportResults({});
  const dataLines = results.csv.trim().split('\n').slice(1); // drop header
  assert.equal(dataLines.length, employees.length);
  assert.match(results.sha256, /^[0-9a-f]{64}$/);

  const header = results.csv.split('\n')[0];
  assert.equal(header, 'gift_id,place,description,slot,emp_id,winner_name,drawn_at');
  const empIds = dataLines.map((line) => line.split(',')[4]);
  assert.equal(new Set(empIds).size, employees.length, 'no winner appears twice');
  assert.ok(dataLines[0].startsWith('1,1st place,Cash 150000,1,'), 'edited description shows in the export');
  assert.ok(dataLines[1].startsWith('3,2nd place,'), 'moved gift id shows in the export');
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
