import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const indexPath = path.join(ROOT, 'src', 'index.ts');
const indexSource = fs.readFileSync(indexPath, 'utf8');

const requiredMounts = [
  'healthRouter',
  'imageRouter',
  'audioRouter',
  'odesliRouter',
];

const requiredPaths = [
  "app.get('/api-docs.json'",
  "app.use('/api-docs'",
  "app.use('/v1', apiKeyMiddleware)",
  "app.use('/v1', imageRouter)",
  "app.use('/v1', audioRouter)",
  "app.use('/v1', odesliRouter)",
];

const missing = [];
for (const mount of requiredMounts) {
  if (!indexSource.includes(mount)) missing.push(`missing router mount: ${mount}`);
}
for (const route of requiredPaths) {
  if (!indexSource.includes(route)) missing.push(`missing route wiring: ${route}`);
}

const routeFiles = [
  'src/routes/health.ts',
  'src/routes/image.ts',
  'src/routes/audio.ts',
  'src/routes/odesli.ts',
];

for (const relativePath of routeFiles) {
  if (!fs.existsSync(path.join(ROOT, relativePath))) {
    missing.push(`missing route file: ${relativePath}`);
  }
}

if (missing.length > 0) {
  console.error('API route contract check failed:');
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

console.log('API route contract check passed.');
