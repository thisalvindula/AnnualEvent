import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindowState } from '../../app/core/timewindow.js';

const opensAt = new Date('2026-01-01T10:00:00.000Z');
const closesAt = new Date('2026-01-01T10:15:00.000Z'); // 15-minute window

test('draft status is never open, regardless of timestamps', () => {
  const state = computeWindowState({ status: 'draft', opensAt, closesAt }, new Date('2026-01-01T10:05:00.000Z'));
  assert.equal(state.isOpen, false);
  assert.equal(state.status, 'draft');
});

test('closed status is never open', () => {
  const state = computeWindowState({ status: 'closed', opensAt, closesAt }, new Date('2026-01-01T10:05:00.000Z'));
  assert.equal(state.isOpen, false);
  assert.equal(state.status, 'closed');
});

test('open status before opens_at is not yet open', () => {
  const state = computeWindowState({ status: 'open', opensAt, closesAt }, new Date('2026-01-01T09:59:00.000Z'));
  assert.equal(state.isOpen, false);
});

test('open status mid-window is open, with correct seconds remaining', () => {
  const now = new Date('2026-01-01T10:10:00.000Z'); // 5 minutes before close
  const state = computeWindowState({ status: 'open', opensAt, closesAt }, now);
  assert.equal(state.isOpen, true);
  assert.equal(state.status, 'open');
  assert.equal(state.secondsRemaining, 300);
});

test('window boundary: exactly 1 second before close is still open', () => {
  const now = new Date(closesAt.getTime() - 1000);
  const state = computeWindowState({ status: 'open', opensAt, closesAt }, now);
  assert.equal(state.isOpen, true);
  assert.equal(state.secondsRemaining, 1);
});

test('window boundary: exactly at closes_at is closed', () => {
  const state = computeWindowState({ status: 'open', opensAt, closesAt }, closesAt);
  assert.equal(state.isOpen, false);
  assert.equal(state.status, 'closed');
  assert.equal(state.secondsRemaining, 0);
});

test('window boundary: 1 second after close is closed', () => {
  const now = new Date(closesAt.getTime() + 1000);
  const state = computeWindowState({ status: 'open', opensAt, closesAt }, now);
  assert.equal(state.isOpen, false);
  assert.equal(state.status, 'closed');
});

test('missing opens_at/closes_at on an "open" row is treated as not open (defensive)', () => {
  const state = computeWindowState({ status: 'open', opensAt: null, closesAt: null }, new Date());
  assert.equal(state.isOpen, false);
});
