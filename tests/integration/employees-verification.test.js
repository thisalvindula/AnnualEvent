import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { verifyEmployeeCredentials } from '../../app/core/employees/index.js';
import { resetDatabase, makeTestEmployees, seedEmployees, closeAllConnections } from './helpers.js';

const employees = makeTestEmployees(3, 'V');

before(async () => {
  await resetDatabase();
  await seedEmployees(employees);
});

after(closeAllConnections);

test('correct emp_id + correct last4 verifies successfully and returns the name', async () => {
  const emp = employees[0];
  const result = await verifyEmployeeCredentials({ empId: emp.empId, last4: emp.last4, ip: '10.0.0.1', module: 'test' });
  assert.equal(result.ok, true);
  assert.equal(result.name, emp.name);
});

test('a full NIC (old or new format) is accepted in place of the last 4 digits', async () => {
  const emp = employees[0];
  const oldFormat = `96043${emp.last4}V`; // 9 digits: last 4 of them are last4
  const newFormat = `19960430${emp.last4}`;
  for (const [i, input] of [oldFormat, newFormat].entries()) {
    const result = await verifyEmployeeCredentials({ empId: emp.empId, last4: input, ip: `10.0.1.${i}`, module: 'test' });
    assert.equal(result.ok, true, input);
    assert.equal(result.name, emp.name);
  }
  const wrongFull = await verifyEmployeeCredentials({ empId: emp.empId, last4: '199604300000', ip: '10.0.1.9', module: 'test' });
  assert.equal(wrongFull.ok, false);
});

test('enumeration resistance: wrong NIC and unknown employee return the identical shape', async () => {
  const emp = employees[1];
  const wrongNic = await verifyEmployeeCredentials({ empId: emp.empId, last4: '0000', ip: '10.0.0.2', module: 'test' });
  const unknownEmp = await verifyEmployeeCredentials({ empId: 'DOES_NOT_EXIST', last4: '0000', ip: '10.0.0.2', module: 'test' });

  assert.deepEqual(wrongNic, unknownEmp);
  assert.equal(wrongNic.ok, false);
  assert.equal(wrongNic.reason, 'invalid');
  assert.equal(wrongNic.message, 'Please contact HR');
});

test('malformed last4 input (not exactly 4 digits) is rejected with the same generic shape', async () => {
  const emp = employees[1];
  const result = await verifyEmployeeCredentials({ empId: emp.empId, last4: 'abcd', ip: '10.0.0.3', module: 'test' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid');
  assert.equal(result.message, 'Please contact HR');
});

test('3 wrong attempts lock the employee ID; a 4th attempt (even correct) is rejected as locked', async () => {
  const emp = employees[2];
  const ip = '10.0.0.4';

  for (let i = 0; i < 3; i++) {
    const result = await verifyEmployeeCredentials({ empId: emp.empId, last4: '9999', ip, module: 'test' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid');
  }

  const lockedEvenCorrect = await verifyEmployeeCredentials({ empId: emp.empId, last4: emp.last4, ip, module: 'test' });
  assert.equal(lockedEvenCorrect.ok, false);
  assert.equal(lockedEvenCorrect.reason, 'locked');
});
