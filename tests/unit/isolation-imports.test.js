import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Requirement 6/12: "modules/raffle and modules/voting must never import
// from each other" — a test scans that neither module imports from the
// other. This walks every file under each module directory and checks its
// source text for any reference to the other module's path.

const appDir = fileURLToPath(new URL('../../app', import.meta.url));
const raffleDir = path.join(appDir, 'modules', 'raffle');
const votingDir = path.join(appDir, 'modules', 'voting');

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const frontendRaffleDir = path.join(repoRoot, 'frontend', 'raffle');
const frontendVotingDir = path.join(repoRoot, 'frontend', 'voting');
const frontendAdminRaffleDir = path.join(repoRoot, 'frontend', 'admin', 'raffle');
const frontendAdminVoteDir = path.join(repoRoot, 'frontend', 'admin', 'vote');

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function assertNoReferenceTo(files, forbiddenSubstring, label, base = appDir) {
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      new RegExp(forbiddenSubstring),
      `${label}: ${path.relative(base, file)} must not reference "${forbiddenSubstring}"`
    );
  }
}

test('modules/raffle never references modules/voting', () => {
  const files = listFiles(raffleDir);
  assert.ok(files.length > 0, 'expected raffle module files to exist');
  assertNoReferenceTo(files, 'modules/voting', 'raffle -> voting');
  assertNoReferenceTo(files, "['\"]\\.\\./voting", 'raffle -> ../voting');
});

test('modules/voting never references modules/raffle', () => {
  const files = listFiles(votingDir);
  assert.ok(files.length > 0, 'expected voting module files to exist');
  assertNoReferenceTo(files, 'modules/raffle', 'voting -> raffle');
  assertNoReferenceTo(files, "['\"]\\.\\./raffle", 'voting -> ../raffle');
});

// Note: core is deliberately allowed to import FROM modules (e.g.
// core/routes.js reads each module's own status() for the shared /admin
// dashboard). The requirement (section 6) only forbids raffle <-> voting
// importing each other; core sitting "above" both is fine and does not
// create a raffle<->voting path either way.

// The same isolation rule extends to the React/Vite frontend (Docs/REACT_FRONTEND_PROMPT.md):
// frontend/raffle and frontend/voting must never import each other, and the
// split admin bundles (frontend/admin/raffle, frontend/admin/vote) must not
// create a raffle<->voting dependency either.

test('frontend/raffle never references frontend/voting', () => {
  const files = listFiles(frontendRaffleDir);
  assert.ok(files.length > 0, 'expected frontend/raffle files to exist');
  assertNoReferenceTo(files, 'frontend/voting', 'frontend raffle -> voting', repoRoot);
  assertNoReferenceTo(files, "['\"]\\.\\./\\.\\./voting", 'frontend raffle -> ../../voting', repoRoot);
  assertNoReferenceTo(files, "['\"]\\.\\./voting", 'frontend raffle -> ../voting', repoRoot);
});

test('frontend/voting never references frontend/raffle', () => {
  const files = listFiles(frontendVotingDir);
  assert.ok(files.length > 0, 'expected frontend/voting files to exist');
  assertNoReferenceTo(files, 'frontend/raffle', 'frontend voting -> raffle', repoRoot);
  assertNoReferenceTo(files, "['\"]\\.\\./\\.\\./raffle", 'frontend voting -> ../../raffle', repoRoot);
  assertNoReferenceTo(files, "['\"]\\.\\./raffle", 'frontend voting -> ../raffle', repoRoot);
});

test('frontend/admin/raffle never references frontend/voting', () => {
  const files = listFiles(frontendAdminRaffleDir);
  assert.ok(files.length > 0, 'expected frontend/admin/raffle files to exist');
  assertNoReferenceTo(files, 'frontend/voting', 'frontend admin/raffle -> voting', repoRoot);
  assertNoReferenceTo(files, "['\"]\\.\\./\\.\\./voting", 'frontend admin/raffle -> ../../voting', repoRoot);
});

test('frontend/admin/vote never references frontend/raffle', () => {
  const files = listFiles(frontendAdminVoteDir);
  assert.ok(files.length > 0, 'expected frontend/admin/vote files to exist');
  assertNoReferenceTo(files, 'frontend/raffle', 'frontend admin/vote -> raffle', repoRoot);
  assertNoReferenceTo(files, "['\"]\\.\\./\\.\\./raffle", 'frontend admin/vote -> ../../raffle', repoRoot);
});
