import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

// Employee pages must stay well under the 50 KB gzipped-JS budget from
// Docs/REQUIREMENTS.md section 5 (target 15-20 KB). Run after
// `npm run build:frontend`.

const BUDGET_BYTES = 50 * 1024;
const TARGET_BYTES = 20 * 1024;

const distRoot = 'frontend/dist';
const pagesToCheck = [
  { name: 'raffle/register', htmlPath: path.join(distRoot, 'raffle/register/index.html') },
  { name: 'voting/vote', htmlPath: path.join(distRoot, 'voting/vote/index.html') },
];

function extractAssetPaths(html) {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
}

let failed = false;
for (const page of pagesToCheck) {
  let html;
  try {
    html = readFileSync(page.htmlPath, 'utf8');
  } catch {
    console.error(`${page.name}: could not read ${page.htmlPath} — run "npm run build:frontend" first`);
    failed = true;
    continue;
  }

  const assets = extractAssetPaths(html);
  let total = 0;
  for (const assetUrl of assets) {
    const filePath = path.join(distRoot, assetUrl.replace(/^\//, ''));
    total += gzipSync(readFileSync(filePath)).length;
  }

  const kb = (total / 1024).toFixed(1);
  console.log(`${page.name}: ${kb} KB gzipped (${assets.length} asset file${assets.length === 1 ? '' : 's'})`);

  if (total > BUDGET_BYTES) {
    console.error(`  FAIL: exceeds the ${BUDGET_BYTES / 1024} KB hard budget`);
    failed = true;
  } else if (total > TARGET_BYTES) {
    console.warn(`  WARN: exceeds the ${TARGET_BYTES / 1024} KB ideal target (still under the hard budget)`);
  }
}

process.exit(failed ? 1 : 0);
