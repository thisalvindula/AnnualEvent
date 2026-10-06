import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLast4FromFullNic,
  extractLast4FromUserInput,
  isValidLast4Input,
  normalizeLast4Input,
} from '../../app/core/nic.js';

test('old format (9 digits + V/X) extracts the last 4 of the 9 digits, ignoring the letter', () => {
  assert.equal(extractLast4FromFullNic('960433149V'), '3149');
  assert.equal(extractLast4FromFullNic('910098765X'), '8765');
});

test('new format (12 digits) extracts the last 4 digits', () => {
  assert.equal(extractLast4FromFullNic('199604303149'), '3149');
});

test('normalizes case and surrounding whitespace before parsing', () => {
  assert.equal(extractLast4FromFullNic('960433149v'), '3149');
  assert.equal(extractLast4FromFullNic('  960433149V  '), '3149');
});

test('rejects anything that is not exactly 9 digits+letter or 12 digits', () => {
  assert.equal(extractLast4FromFullNic('12345'), null); // too short
  assert.equal(extractLast4FromFullNic('199604303149999'), null); // too long
  assert.equal(extractLast4FromFullNic('960433149Z'), null); // wrong letter
  assert.equal(extractLast4FromFullNic('96043314AV'), null); // letter in the digit run
  assert.equal(extractLast4FromFullNic(''), null);
  assert.equal(extractLast4FromFullNic(undefined), null);
  assert.equal(extractLast4FromFullNic(null), null);
});

test('isValidLast4Input accepts only exactly 4 digits (after trimming)', () => {
  assert.equal(isValidLast4Input('1234'), true);
  assert.equal(isValidLast4Input(' 1234 '), true);
  assert.equal(isValidLast4Input('123'), false);
  assert.equal(isValidLast4Input('12345'), false);
  assert.equal(isValidLast4Input('12a4'), false);
  assert.equal(isValidLast4Input(''), false);
  assert.equal(isValidLast4Input(undefined), false);
});

test('normalizeLast4Input trims strings and passes through non-strings unchanged', () => {
  assert.equal(normalizeLast4Input(' 1234 '), '1234');
  assert.equal(normalizeLast4Input(undefined), undefined);
});

test('extractLast4FromUserInput accepts the last 4 digits or a full NIC in either format', () => {
  assert.equal(extractLast4FromUserInput('3149'), '3149');
  assert.equal(extractLast4FromUserInput(' 3149 '), '3149');
  assert.equal(extractLast4FromUserInput('960433149V'), '3149');
  assert.equal(extractLast4FromUserInput('960433149v'), '3149');
  assert.equal(extractLast4FromUserInput('199604303149'), '3149');
});

test('extractLast4FromUserInput rejects anything else', () => {
  assert.equal(extractLast4FromUserInput('123'), null);
  assert.equal(extractLast4FromUserInput('12345'), null);
  assert.equal(extractLast4FromUserInput('abcd'), null);
  assert.equal(extractLast4FromUserInput('960433149Z'), null);
  assert.equal(extractLast4FromUserInput(''), null);
  assert.equal(extractLast4FromUserInput(undefined), null);
});
