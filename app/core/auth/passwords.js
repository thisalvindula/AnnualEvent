import argon2 from 'argon2';

export function hashPassword(plain) {
  return argon2.hash(plain);
}

export function verifyPassword(hash, plain) {
  return argon2.verify(hash, plain);
}
