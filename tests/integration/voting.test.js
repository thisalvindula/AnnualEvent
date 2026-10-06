import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as voting from '../../app/modules/voting/service.js';
import * as votingRepo from '../../app/modules/voting/repo.js';
import { resetDatabase, makeTestEmployees, seedEmployees, createAdmin, sleep, closeAllConnections } from './helpers.js';

const employees = makeTestEmployees(8, 'W');
const finalists = [
  { name: 'Alice', song: 'Song A', position: 1 },
  { name: 'Bob', song: 'Song B', position: 2 },
  { name: 'Chamari', song: 'Song C', position: 3 },
  { name: 'Dinesh', song: 'Song D', position: 4 },
  { name: 'Eshan', song: 'Song E', position: 5 },
];

let finalistIds;

before(async () => {
  await resetDatabase();
  await seedEmployees(employees);
  await createAdmin('vote_reset_test', 'correct-horse-battery', 'vote_operator');
});

after(async () => {
  // cast() schedules a throttled (<=1s) tally publish via setTimeout that
  // isn't awaited (by design — it must not slow down the voter's response).
  // Give it time to fire before closing the pool, or it errors trying to
  // query a closed pool during teardown (harmless in production, where the
  // server process never shuts down mid-request).
  await sleep(1100);
  await closeAllConnections();
});

test('finalists must be exactly 5 with unique positions 1-5', async () => {
  const tooFew = await voting.setFinalists(finalists.slice(0, 4));
  assert.equal(tooFew.ok, false);

  const dupPositions = await voting.setFinalists(finalists.map((f) => ({ ...f, position: 1 })));
  assert.equal(dupPositions.ok, false);
});

test('a correctly composed finalist list is accepted', async () => {
  const result = await voting.setFinalists(finalists);
  assert.equal(result.ok, true);
  assert.equal(result.finalists.length, 5);
});

test('a single finalist can be edited in place while voting is still in draft', async () => {
  const [first] = await votingRepo.getFinalists();

  const edited = await voting.updateFinalist(first.id, { name: '  Alicia ', song: '', empId: employees[0].empId });
  assert.equal(edited.ok, true);
  assert.deepEqual(
    { name: edited.finalist.name, song: edited.finalist.song, empId: edited.finalist.empId, position: edited.finalist.position },
    { name: 'Alicia', song: null, empId: employees[0].empId, position: 1 }
  );

  assert.equal((await voting.updateFinalist(first.id, { name: '  ' })).ok, false, 'name is required');
  assert.equal((await voting.updateFinalist(first.id, { empId: 'NO-SUCH-EMP' })).ok, false, 'unknown employee refused');
  assert.equal((await voting.updateFinalist(999999, { name: 'x' })).reason, 'not_found');

  // Unspecified fields are kept; restore the original values for the later tests.
  const restored = await voting.updateFinalist(first.id, { name: 'Alice', song: 'Song A', empId: null });
  assert.equal(restored.ok, true);
  assert.equal((await votingRepo.getFinalists())[0].name, 'Alice');
});

test('casting a vote before voting starts is rejected', async () => {
  const emp = employees[0];
  const result = await voting.cast({ empId: emp.empId, last4: emp.last4, finalistId: 1, ip: '1.1.1.1' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'closed');
});

test('starting requires all 5 finalists (already satisfied) and sets a real window', async () => {
  const result = await voting.start({});
  assert.equal(result.ok, true);
  assert.equal(result.config.status, 'open');

  const [locked] = await votingRepo.getFinalists();
  const refused = await voting.updateFinalist(locked.id, { name: 'Changed mid-vote' });
  assert.equal(refused.ok, false, 'finalists are locked once voting has started');

  // Fetch real finalist IDs (assigned by the DB) for casting in later tests.
  const verifyResult = await voting.verify({ empId: employees[0].empId, last4: employees[0].last4, ip: '1.1.1.1' });
  finalistIds = verifyResult.finalists;
});

test('finalists cannot be edited once voting has started', async () => {
  const result = await voting.setFinalists(finalists.map((f) => ({ ...f, name: f.name + ' EDITED' })));
  assert.equal(result.ok, false);
  assert.match(result.message, /started/);
});

test('verify returns the finalist list but never vote counts', async () => {
  const emp = employees[1];
  const result = await voting.verify({ empId: emp.empId, last4: emp.last4, ip: '2.2.2.2' });
  assert.equal(result.ok, true);
  assert.equal(result.finalists.length, 5);
  for (const f of result.finalists) {
    assert.equal('votes' in f, false, 'finalist list shown to voters must not include vote counts');
  }
});

test('finalists may vote for themselves (self-voting is explicitly allowed)', async () => {
  // Employee W001 votes for finalist at position 1 — standing in for a
  // finalist voting for their own entry; the service applies no restriction
  // based on who the voter is.
  const emp = employees[0];
  const self = finalistIds[0]; // position 1
  const result = await voting.cast({ empId: emp.empId, last4: emp.last4, finalistId: self.id, ip: '1.1.1.1' });
  assert.equal(result.ok, true);
  assert.equal(result.message, 'Vote recorded');
});

test('a second vote from the same employee is rejected — first vote is final', async () => {
  const emp = employees[0];
  const result = await voting.cast({ empId: emp.empId, last4: emp.last4, finalistId: finalistIds[1].id, ip: '1.1.1.1' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already_voted');
  assert.equal(result.message, 'You have already voted');

  const verifyAgain = await voting.verify({ empId: emp.empId, last4: emp.last4, ip: '1.1.1.1' });
  assert.equal(verifyAgain.ok, false);
  assert.equal(verifyAgain.reason, 'already_voted');
});

test('voting for a nonexistent finalist id is rejected', async () => {
  const emp = employees[2];
  const result = await voting.cast({ empId: emp.empId, last4: emp.last4, finalistId: 999999, ip: '3.3.3.3' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_finalist');
});

test('concurrency: 50 simultaneous votes from the same employee yield exactly one success', async () => {
  const emp = employees[3];
  const attempts = await Promise.all(
    Array.from({ length: 50 }, () =>
      voting.cast({ empId: emp.empId, last4: emp.last4, finalistId: finalistIds[2].id, ip: '4.4.4.4' })
    )
  );
  const successes = attempts.filter((r) => r.ok === true);
  const alreadyVoted = attempts.filter((r) => r.ok === false && r.reason === 'already_voted');

  assert.equal(successes.length, 1);
  assert.equal(alreadyVoted.length, 49);
});

test('remaining employees vote; live tally matches the votes cast', async () => {
  // [0] and [3] already voted (self-vote and concurrency tests above); [1]
  // only verified and [2] only attempted an invalid finalist — neither has
  // a successful vote yet, so both still need to vote here too.
  const stillToVote = [employees[1], employees[2], ...employees.slice(4)];
  for (const emp of stillToVote) {
    const result = await voting.cast({ empId: emp.empId, last4: emp.last4, finalistId: finalistIds[3].id, ip: '5.5.5.5' });
    assert.equal(result.ok, true);
  }
  const { tally, totalVotes } = await voting.getTally();
  assert.equal(totalVotes, employees.length);
  const dinesh = tally.find((f) => f.position === 4);
  assert.equal(dinesh.votes, stillToVote.length); // everyone in this loop voted for position 4
});

test('exporting results before close is rejected', async () => {
  const result = await voting.exportResults({});
  assert.equal(result.ok, false);
  assert.match(result.message, /Close voting/);
});

test('close, then export votes CSV (with employee IDs) + tally hash', async () => {
  const closeResult = await voting.close({});
  assert.equal(closeResult.ok, true);
  assert.equal(closeResult.config.status, 'closed');

  const cast = await voting.cast({ empId: 'W099', last4: '9999', finalistId: finalistIds[0].id, ip: '6.6.6.6' });
  assert.equal(cast.ok, false);
  assert.equal(cast.reason, 'closed');

  const results = await voting.exportResults({});
  const dataLines = results.csv.trim().split('\n').slice(1);
  assert.equal(dataLines.length, employees.length);
  assert.equal(results.totalVotes, employees.length);
  assert.match(results.tallySha256, /^[0-9a-f]{64}$/);
  // Every exported row includes the employee ID (traceability, requirement 3/10).
  for (const line of dataLines) {
    assert.match(line, /^W\d{3},/);
  }
});

test('reset is rejected with the wrong password, and nothing is wiped', async () => {
  const result = await voting.reset({ username: 'vote_reset_test', password: 'wrong-password' });
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Incorrect password');

  const { totalVotes } = await voting.getTally();
  assert.equal(totalVotes, employees.length);
});

test('reset with the right password wipes votes but keeps finalists, back to draft, and can restart fresh', async () => {
  const result = await voting.reset({ username: 'vote_reset_test', password: 'correct-horse-battery' });
  assert.equal(result.ok, true);

  const { totalVotes } = await voting.getTally();
  assert.equal(totalVotes, 0);

  const restarted = await voting.start({});
  assert.equal(restarted.ok, true, 'finalist list survived the reset, so voting can restart immediately');

  // Someone who voted before the reset can vote again in this fresh run.
  const emp = employees[0];
  const verify = await voting.verify({ empId: emp.empId, last4: emp.last4, ip: '9.9.9.9' });
  assert.equal(verify.ok, true, 'first vote was wiped, so this employee is no longer marked as having voted');
});

test('reset is rejected while voting is open', async () => {
  const result = await voting.reset({ username: 'vote_reset_test', password: 'correct-horse-battery' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Close voting/);
});

test('reset with wipeFinalists also clears the finalist list, requiring reconfiguration before restarting', async () => {
  const closeResult = await voting.close({});
  assert.equal(closeResult.ok, true);

  const result = await voting.reset({
    username: 'vote_reset_test',
    password: 'correct-horse-battery',
    wipeFinalists: true,
  });
  assert.equal(result.ok, true);

  const restarted = await voting.start({});
  assert.equal(restarted.ok, false, 'cannot restart without finalists configured');
  assert.match(restarted.message, /finalists/);
});
