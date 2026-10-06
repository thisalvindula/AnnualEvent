import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptNic, decryptNic, deriveKey } from '../../app/core/nic-crypto.js';
import { normalizeFullNic } from '../../app/core/nic.js';

test('encrypt/decrypt round-trips a NIC, with a fresh IV each time', () => {
  const a = encryptNic('960433149V');
  const b = encryptNic('960433149V');
  assert.notEqual(a, b);
  assert.equal(decryptNic(a), '960433149V');
  assert.equal(decryptNic(b), '960433149V');
  assert.equal(a.includes('960433149'), false, 'plaintext is not visible in the stored value');
});

test('decrypt returns null for empty, redacted, tampered or wrong-key values', () => {
  assert.equal(decryptNic(null), null);
  assert.equal(decryptNic(undefined), null);
  assert.equal(decryptNic('redacted-post-event'), null);

  const stored = encryptNic('199604303149');
  const parts = stored.split(':');
  parts[3] = Buffer.from('tampered!!!!').toString('base64');
  assert.equal(decryptNic(parts.join(':')), null);

  assert.equal(decryptNic(stored, deriveKey('some-other-pepper')), null);
});

test('normalizeFullNic upper-cases and trims valid NICs, rejects invalid ones', () => {
  assert.equal(normalizeFullNic('  960433149v '), '960433149V');
  assert.equal(normalizeFullNic('199604303149'), '199604303149');
  assert.equal(normalizeFullNic('12345'), null);
  assert.equal(normalizeFullNic(null), null);
});
