import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEmployeeCsv,
  importEmployees,
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  findEmployeeById,
  verifyEmployeeCredentials,
} from '../../app/core/employees/index.js';
import * as raffle from '../../app/modules/raffle/service.js';
import { resetDatabase, seedGifts, sleep, closeAllConnections } from './helpers.js';

before(resetDatabase);
after(closeAllConnections);

const verify = (empId, last4, ip = '10.1.0.1') => verifyEmployeeCredentials({ empId, last4, ip, module: 'test' });

test('CSV import reads emp_id,name,nic,image_name and ignores a legacy dept column', async () => {
  const csv = [
    'emp_id,name,dept,nic,image_name',
    'A001,Alice Perera,Finance,960433149V,alice.jpg',
    'A002,Bob Silva,IT,199604303149,',
  ].join('\n');
  const { valid, errors } = parseEmployeeCsv(csv);
  assert.deepEqual(errors, []);
  assert.deepEqual(valid.map((r) => [r.empId, r.imageName, r.last4]), [
    ['A001', 'alice.jpg', '3149'],
    ['A002', null, '3149'],
  ]);
  assert.equal(Object.hasOwn(valid[0], 'dept'), false);

  const result = await importEmployees(valid);
  assert.equal(result.imported, 2);
  assert.deepEqual(await listEmployees(), [
    { empId: 'A001', name: 'Alice Perera', imageName: 'alice.jpg', nic: '960433149V' },
    { empId: 'A002', name: 'Bob Silva', imageName: null, nic: '199604303149' },
  ]);
});

test('CSV import: image_name column is optional, bad image names are reported per row', () => {
  const noImageColumn = parseEmployeeCsv('emp_id,name,nic\nA010,Carol,960433149V');
  assert.equal(noImageColumn.errors.length, 0);
  assert.equal(noImageColumn.valid[0].imageName, null);

  const bad = parseEmployeeCsv('emp_id,name,nic,image_name\nA011,Dan,960433149V,../etc/passwd\nA012,Eve,960433149V,ok.png');
  assert.equal(bad.valid.length, 1);
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.errors[0].empId, 'A011');
  assert.match(bad.errors[0].reason, /Invalid image name/);
});

test('re-importing without an image name keeps the existing image', async () => {
  const { valid } = parseEmployeeCsv('emp_id,name,nic\nA001,Alice P. Perera,960433149V');
  await importEmployees(valid);
  const alice = await findEmployeeById('A001');
  assert.equal(alice.name, 'Alice P. Perera');
  assert.equal(alice.image_name, 'alice.jpg');
});

test('admin can add an employee, who can then verify with the new NIC; duplicates are refused', async () => {
  const created = await createEmployee({ empId: 'N001', name: 'New Person', nic: '199604301234', imageName: 'N001.jpg' });
  assert.equal(created.ok, true);
  assert.equal((await verify('N001', '1234')).ok, true);

  const duplicate = await createEmployee({ empId: 'N001', name: 'Other', nic: '199604301234' });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, 'exists');
  assert.equal((await findEmployeeById('N001')).name, 'New Person', 'existing record untouched');
});

test('adding an employee validates name, NIC and image name', async () => {
  const base = { empId: 'N002', name: 'Valid', nic: '199604301234' };
  assert.equal((await createEmployee({ ...base, name: '  ' })).ok, false);
  assert.equal((await createEmployee({ ...base, empId: '' })).ok, false);
  assert.equal((await createEmployee({ ...base, nic: '12345' })).ok, false);
  assert.equal((await createEmployee({ ...base, imageName: '../x.jpg' })).ok, false);
  assert.equal((await createEmployee({ ...base, imageName: 'a/b.jpg' })).ok, false);
  assert.equal(await findEmployeeById('N002'), null);
});

test('editing changes name/image without touching the NIC; a new NIC replaces the old one', async () => {
  const edited = await updateEmployee('N001', { name: 'Renamed Person', imageName: 'renamed.png' });
  assert.equal(edited.ok, true);
  const row = await findEmployeeById('N001');
  assert.equal(row.name, 'Renamed Person');
  assert.equal(row.image_name, 'renamed.png');
  assert.equal((await verify('N001', '1234')).ok, true, 'old NIC still works when none supplied');

  const newNic = await updateEmployee('N001', { nic: '960437777V' });
  assert.equal(newNic.ok, true);
  assert.equal((await verify('N001', '7777', '10.1.0.9')).ok, true);
  assert.equal((await verify('N001', '1234', '10.1.0.9')).ok, false, 'old NIC no longer verifies');

  const cleared = await updateEmployee('N001', { imageName: null });
  assert.equal(cleared.ok, true);
  assert.equal((await findEmployeeById('N001')).image_name, null);

  assert.equal((await updateEmployee('N001', { nic: 'nonsense' })).ok, false);
  assert.equal((await updateEmployee('N001', { name: '' })).ok, false);
  assert.equal((await updateEmployee('NOPE', { name: 'x' })).reason, 'not_found');
});

test('admins can read the stored NIC back, and fixing a wrong NIC lets a locked-out employee in at once', async () => {
  await createEmployee({ empId: 'L001', name: 'Locked Out', nic: '199604301111' });
  const listed = (await listEmployees()).find((e) => e.empId === 'L001');
  assert.equal(listed.nic, '199604301111');

  // The employee's real NIC differs from what was entered; 3 wrong tries lock them out.
  for (let i = 0; i < 3; i++) assert.equal((await verify('L001', '2222', '10.1.0.20')).ok, false);
  assert.equal((await verify('L001', '2222', '10.1.0.20')).reason, 'locked');

  // Re-saving the same NIC changes nothing (lockout stays)...
  await updateEmployee('L001', { nic: '199604301111' });
  assert.equal((await verify('L001', '2222', '10.1.0.20')).reason, 'locked');

  // ...but correcting it updates the hash and lifts the lockout.
  const fixed = await updateEmployee('L001', { nic: '960432222v' });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.employee.nic, '960432222V', 'stored normalised to upper case');
  assert.equal((await verify('L001', '2222', '10.1.0.20')).ok, true);
  assert.equal((await listEmployees()).find((e) => e.empId === 'L001').nic, '960432222V');
});

test('an employee without a stored NIC lists as null; an invalid NIC edit is still rejected', async () => {
  await importEmployees([{ empId: 'L002', name: 'Legacy', imageName: null, last4: '4444' }]);
  assert.equal((await listEmployees()).find((e) => e.empId === 'L002').nic, null);
  assert.equal((await verify('L002', '4444', '10.1.0.21')).ok, true, 'verification unaffected');

  assert.equal((await updateEmployee('L002', { nic: 'nonsense' })).ok, false);
  assert.equal((await updateEmployee('L002', { nic: '199604304444' })).ok, true);
  assert.equal((await listEmployees()).find((e) => e.empId === 'L002').nic, '199604304444');
});

test('an employee with no raffle entry/vote can be deleted; one with an entry cannot', async () => {
  assert.equal((await deleteEmployee('A002')).ok, true);
  assert.equal(await findEmployeeById('A002'), null);
  assert.equal((await deleteEmployee('A002')).reason, 'not_found');

  await seedGifts([{ id: 1, place: '1st place', quantity: 1, description: 'Cash' }]);
  assert.equal((await raffle.open({ windowMinutes: 0.05 })).ok, true);
  const registered = await raffle.register({ empId: 'N001', last4: '7777', ip: '10.1.0.5' });
  assert.equal(registered.ok, true);

  const blocked = await deleteEmployee('N001');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'in_use');
  assert.ok(await findEmployeeById('N001'), 'employee still exists');

  await sleep(3200); // let the 3s window lapse so the raffle isn't left open
});
