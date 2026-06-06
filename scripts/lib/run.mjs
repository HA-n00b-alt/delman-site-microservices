import { spawnSync } from 'node:child_process';

export function run(command, args, options = {}) {
  const label = options.label ?? [command, ...args].join(' ');
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...options.env },
    cwd: options.cwd ?? process.cwd(),
  });
  if (result.status !== 0) {
    console.error(`✗ Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
  console.log(`✓ ${label}`);
}

export function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ...options.env },
    cwd: options.cwd ?? process.cwd(),
  });
  if (result.status !== 0) {
    const label = options.label ?? [command, ...args].join(' ');
    console.error(`✗ Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return (result.stdout ?? '').trim();
}
