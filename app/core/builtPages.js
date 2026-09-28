import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Each built page's index.html is read once at startup (not per-request) and
// served behind the exact same preHandlers the old inline-HTML routes used.
// Throws (ENOENT) at import time if `npm run build:frontend` wasn't run
// first — fails loudly at boot rather than a confusing 500 mid-event.

const dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(dirname, '../../frontend/dist');

function load(relPath) {
  return readFileSync(path.join(distDir, relPath), 'utf8');
}

export const pages = {
  raffleRegister: load('raffle/register/index.html'),
  raffleScreen: load('raffle/screen/index.html'),
  voteVote: load('voting/vote/index.html'),
  voteScreen: load('voting/screen/index.html'),
  adminLogin: load('admin/login/index.html'),
  adminDashboard: load('admin/dashboard/index.html'),
  adminLists: load('admin/lists/index.html'),
  adminRaffle: load('admin/raffle/index.html'),
  adminVote: load('admin/vote/index.html'),
};

export function sendPage(reply, html) {
  reply.type('text/html').header('Cache-Control', 'no-cache').send(html);
}
