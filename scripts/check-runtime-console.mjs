import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const ALLOWED = new Set([path.join(SRC_ROOT, 'config', 'env.ts')]);

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

const consolePattern = /\bconsole\.(log|debug|info|warn|error)\(/;
const violations = [];

for (const absolutePath of files) {
  if (!absolutePath.endsWith('.ts')) continue;
  if (absolutePath.endsWith('.test.ts')) continue;
  if (ALLOWED.has(absolutePath)) continue;

  const content = fs.readFileSync(absolutePath, 'utf8');
  if (!consolePattern.test(content)) continue;

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (consolePattern.test(lines[i] ?? '')) {
      violations.push(`${toPosix(path.relative(ROOT, absolutePath))}:${i + 1}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Runtime console check failed: use Pino logger instead of console.* in src/.');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Runtime console check passed.');
