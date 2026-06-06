import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const ALLOWED_ENV_FILES = new Set([
  path.join(SRC_ROOT, 'config', 'env.ts'),
]);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, out);
      continue;
    }
    out.push(absolutePath);
  }
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

const files = [];
walk(SRC_ROOT, files);

const violations = [];
for (const absolutePath of files) {
  if (!absolutePath.endsWith('.ts')) continue;
  if (absolutePath.endsWith('.test.ts')) continue;
  if (!ALLOWED_ENV_FILES.has(absolutePath) && fs.readFileSync(absolutePath, 'utf8').includes('process.env')) {
    violations.push(toPosix(path.relative(ROOT, absolutePath)));
  }
}

if (violations.length > 0) {
  console.error('Environment contract violation: process.env is only allowed in src/config/env.ts.');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Environment contract check passed.');
