import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../../app/core/auth/passwords.js';

test('hash comparison: correct password verifies true', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword(hash, 'correct horse battery staple'), true);
});

test('hash comparison: wrong password verifies false', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword(hash, 'wrong password'), false);
});

test('the stored hash is never the plaintext password', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.match(hash, /^\$argon2/);
});

test('hashing the same password twice produces different hashes (random salt)', async () => {
  const [hashA, hashB] = await Promise.all([hashPassword('same password'), hashPassword('same password')]);
  assert.notEqual(hashA, hashB);
  // but both still verify correctly against the same plaintext
  assert.equal(await verifyPassword(hashA, 'same password'), true);
  assert.equal(await verifyPassword(hashB, 'same password'), true);
});
