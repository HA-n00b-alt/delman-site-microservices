import fs from 'node:fs';
import path from 'node:path';

function parseEnvFile(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** Read deploy secrets from local env files (.secrets.env overrides .env). */
export function readLocalDeployEnv(rootDir = process.cwd()) {
  return {
    ...parseEnvFile(path.join(rootDir, '.env')),
    ...parseEnvFile(path.join(rootDir, '.secrets.env')),
  };
}
