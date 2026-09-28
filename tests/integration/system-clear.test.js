import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as raffle from '../../app/modules/raffle/service.js';
import * as raffleRepo from '../../app/modules/raffle/repo.js';
import * as voting from '../../app/modules/voting/service.js';
import * as votingRepo from '../../app/modules/voting/repo.js';
import * as system from '../../app/core/system/service.js';
import { findEmployeeById } from '../../app/core/employees/index.js';
import { findAdminByUsername } from '../../app/core/auth/repo.js';
import { exportAuditCsv } from '../../app/core/audit/index.js';
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

const employees = makeTestEmployees(3, 'C');
const finalists = [
  { name: 'Alice', song: 'Song A', position: 1 },
  { name: 'Bob', song: 'Song B', position: 2 },
  { name: 'Chamari', song: 'Song C', position: 3 },
  { name: 'Dinesh', song: 'Song D', position: 4 },
  { name: 'Eshan', song: 'Song E', position: 5 },
];

before(async () => {
  await resetDatabase();
  await seedEmployees(employees);
  await createAdmin('system_clear_test', 'correct-horse-battery', 'raffle_operator');

  await raffle.setGifts([...normalGifts(10), ...premiumGifts(15)]);
  await raffle.open({ windowMinutes: 0.05 }); // 3 seconds
  await raffle.register({ empId: employees[0].empId, last4: employees[0].last4, ip: '1.1.1.1' });
  await sleep(3500);
  await raffle.close({});

  await voting.setFinalists(finalists);
  await voting.start({});
  await voting.cast({ empId: employees[1].empId, last4: employees[1].last4, finalistId: 1, ip: '2.2.2.2' });
  await voting.close({});
});

after(async () => {
  await sleep(1100); // let voting.cast's throttled tally publish fire before the pool closes
  await closeAllConnections();
});

test('clearDatabase is rejected with the wrong password, and nothing is wiped', async () => {
  const result = await system.clearDatabase({ username: 'system_clear_test', password: 'wrong-password' });
  assert.equal(result.ok, false);
  assert.equal(result.message, 'Incorrect password');

  const employee = await findEmployeeById(employees[0].empId);
  assert.ok(employee, 'employee should still exist');
});

test('clearDatabase is rejected while the raffle is open', async () => {
  const opened = await raffle.open({ windowMinutes: 1 });
  assert.equal(opened.ok, true);

  const result = await system.clearDatabase({ username: 'system_clear_test', password: 'correct-horse-battery' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Close the raffle/);

  await raffle.close({});
});

test('clearDatabase wipes employees + raffle/voting data but keeps admin_users and audit_log', async () => {
  const result = await system.clearDatabase({ username: 'system_clear_test', password: 'correct-horse-battery' });
  assert.equal(result.ok, true);

  const employee = await findEmployeeById(employees[0].empId);
  assert.equal(employee, null, 'employees should be wiped');

  const raffleStatus = await raffle.getStatus();
  assert.equal(raffleStatus.status, 'draft');
  assert.equal(raffleStatus.entryCount, 0);
  const gifts = await raffleRepo.getGifts();
  assert.equal(gifts.length, 0, 'gift list should be wiped too');

  const voteDetail = await votingRepo.getConfig();
  assert.equal(voteDetail.status, 'draft');
  const voteFinalists = await votingRepo.getFinalists();
  assert.equal(voteFinalists.length, 0, 'finalist list should be wiped too');
  const { totalVotes } = await voting.getTally();
  assert.equal(totalVotes, 0);

  const admin = await findAdminByUsername('system_clear_test');
  assert.ok(admin, 'admin_users must survive a full clear');

  const auditCsv = await exportAuditCsv();
  const auditLines = auditCsv.trim().split('\n').slice(1); // drop header
  assert.ok(auditLines.length > 0, 'audit_log must survive a full clear');
});
