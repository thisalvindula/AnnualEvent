// Reversible encryption for the full NIC, so admins can read it back on the
// Lists page. Verification never uses this — it only uses the hashed last 4.
//
// AES-256-GCM with a random 12-byte IV per value. The key is derived from
// NIC_PEPPER (HKDF, distinct "info" label) so no extra env var is required;
// rotating NIC_PEPPER therefore also makes old encrypted NICs unreadable
// (they show as blank until re-imported), same as it invalidates the hashes.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';

function deriveKey(secret) {
  return Buffer.from(hkdfSync('sha256', secret, 'annual-event-nic', 'nic-encryption', 32));
}

const defaultKey = deriveKey(config.nicPepper);

/** Returns "v1:<iv>:<tag>:<ciphertext>" (base64 parts). */
export function encryptNic(nic, key = defaultKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(nic, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Returns the NIC, or null when the value is empty, redacted, tampered with or from another key. */
export function decryptNic(stored, key = defaultKey) {
  if (typeof stored !== 'string') return null;
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export { deriveKey };
