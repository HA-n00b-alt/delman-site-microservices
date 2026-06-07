const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function main() {
  const { loadLocalDotenv } = await import('./lib/load-dotenv.mjs');
  const { readLocalDeployEnv } = await import('./lib/read-local-env.mjs');
  const { auditDeploySecrets, hasDeploySecretErrors, printDeploySecretIssues } = await import('./lib/audit-deploy-secrets.mjs');
  const { run, runCapture } = await import('./lib/run.mjs');
  const { confirm } = await import('./lib/prompt.mjs');

  loadLocalDotenv();
  loadLocalDotenv('.secrets.env');

  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const skipGit = args.has('--no-git');
  const yesGit = args.has('--yes-git');

  const configPath = path.join(process.cwd(), 'deploy.config.json');
  if (!fs.existsSync(configPath)) {
    console.error('Missing deploy.config.json');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const projectId = process.env.GCP_PROJECT_ID ?? config.gcpProjectId;
  const region = process.env.GCP_REGION ?? config.region;
  const serviceName = config.serviceName;
  const repository = config.repository;
  const imageName = config.imageName;
  const imageUri = `${region}-docker.pkg.dev/${projectId}/${repository}/${imageName}`;
  const deployEnvVars = Array.isArray(config.deployEnvVars) ? config.deployEnvVars : [];

  function step(title) {
    console.log(`\n=== ${title} ===`);
  }

  function loadCloudRunEnv() {
    try {
      const raw = runCapture('gcloud', [
        'run', 'services', 'describe', serviceName,
        '--project', projectId,
        '--region', region,
        '--format', 'json',
      ], { label: 'read Cloud Run env for deploy audit' });
      const parsed = JSON.parse(raw);
      const envVars = parsed?.spec?.template?.spec?.containers?.[0]?.env ?? [];
      return Object.fromEntries(
        envVars
          .filter((entry) => entry.name && entry.value)
          .map((entry) => [entry.name, entry.value]),
      );
    } catch (err) {
      console.error('Could not read Cloud Run env for deploy audit.');
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  function requireLocalDeployEnv(localEnv) {
    const missing = deployEnvVars.filter((key) => !(localEnv[key] ?? '').trim());
    if (missing.length === 0) return localEnv;

    console.error('Missing required deploy env vars in .env / .secrets.env:');
    for (const key of missing) console.error(`- ${key}`);
    process.exit(1);
  }

  function pickDeployEnv(localEnv) {
    return Object.fromEntries(
      deployEnvVars.map((key) => [key, localEnv[key].trim()]),
    );
  }

  function gitCapture(argsList) {
    return runCapture('git', argsList, { label: `git ${argsList.join(' ')}` });
  }

  function readRemoteManifest() {
    const bucket = (process.env.DEPLOY_MANIFEST_R2_BUCKET ?? '').trim();
    if (!bucket) {
      console.log('Skipping remote manifest read: DEPLOY_MANIFEST_R2_BUCKET not configured.');
      return null;
    }

    console.log(`Remote manifest bucket configured (${bucket}); local deploy will append a new entry after success.`);
    const localManifestPath = path.join(process.cwd(), 'deploy-manifest.json');
    if (!fs.existsSync(localManifestPath)) return null;
    return JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
  }

  function writeLocalManifest(entry) {
    const manifestPath = path.join(process.cwd(), 'deploy-manifest.json');
    const existing = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      : { service: serviceName, deployments: [] };

    existing.service = serviceName;
    existing.projectId = projectId;
    existing.region = region;
    existing.deployments = Array.isArray(existing.deployments) ? existing.deployments : [];
    existing.deployments.unshift(entry);
    existing.deployments = existing.deployments.slice(0, 20);

    fs.writeFileSync(manifestPath, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(`Updated ${manifestPath}`);
  }

  step('1) Run verify');
  run('npm', ['run', 'verify'], {
    env: { NODE_ENV: 'test', SERVICE_API_KEY: 'test-key', CORS_ALLOWED_ORIGINS: 'https://example.com' },
  });

  step('2) Read remote deployment manifest');
  const previousManifest = readRemoteManifest();
  if (previousManifest?.deployments?.[0]) {
    console.log(
      `Last local manifest entry: ${previousManifest.deployments[0].gitSha ?? 'unknown'} @ ${previousManifest.deployments[0].deployedAt ?? 'unknown'}`,
    );
  }

  step('3) Apply pending migrations');
  console.log('Skipped: media-service has no database migrations.');

  step('4) Upload new/changed secrets');
  const localDeployEnv = readLocalDeployEnv();
  const cloudRunEnv = loadCloudRunEnv();
  const secretIssues = auditDeploySecrets(localDeployEnv, cloudRunEnv, deployEnvVars);

  if (secretIssues.length > 0) {
    printDeploySecretIssues(secretIssues);
  }
  if (hasDeploySecretErrors(secretIssues)) {
    console.error('\nDeploy blocked: resolve env drift between local files and Cloud Run first.');
    process.exit(1);
  }

  const deployEnv = requireLocalDeployEnv(localDeployEnv);
  console.log('Local deploy env contract validated against Cloud Run.');

  if (dryRun) {
    console.log('Dry run: secret upload skipped.');
    console.log('\nDry run complete after verify. Skipping build/deploy.');
    process.exit(0);
  }

  const resolvedDeployEnv = pickDeployEnv(deployEnv);
  console.log('Secrets loaded from local env files; will be applied to Cloud Run on deploy.');

  step('5) Build/deploy accessory components');
  console.log('Skipped: no accessory components for media-service.');

  step('6) Build/deploy main service');
  const gitShaFull = gitCapture(['rev-parse', 'HEAD']);
  const gitSha = gitCapture(['rev-parse', '--short', 'HEAD']);
  const imageTag = `${imageUri}:${gitShaFull}`;

  run('gcloud', ['config', 'set', 'project', projectId], { label: `gcloud config set project ${projectId}` });
  run('gcloud', [
    'builds', 'submit',
    '--project', projectId,
    '--region', region,
    '--tag', imageTag,
    '.',
  ]);

  const envYamlPath = path.join(process.cwd(), '.deploy-env.yaml');
  fs.writeFileSync(
    envYamlPath,
    `${deployEnvVars.map((key) => `${key}: ${resolvedDeployEnv[key]}`).join('\n')}\n`,
  );

  try {
    run('gcloud', [
      'run', 'deploy', serviceName,
      '--project', projectId,
      '--image', imageTag,
      '--region', region,
      '--platform', 'managed',
      '--memory', config.memory ?? '1Gi',
      '--cpu', String(config.cpu ?? '1'),
      '--max-instances', String(config.maxInstances ?? 5),
      '--env-vars-file', envYamlPath,
      '--allow-unauthenticated',
      '--quiet',
    ]);
  } finally {
    fs.rmSync(envYamlPath, { force: true });
  }

  const serviceUrl = runCapture('gcloud', [
    'run', 'services', 'describe', serviceName,
    '--project', projectId,
    '--region', region,
    '--format', 'value(status.url)',
  ], { label: 'resolve Cloud Run URL' });

  step('7) Write updated manifest');
  const sourceHash = createHash('sha256')
    .update(fs.readFileSync(path.join(process.cwd(), 'package-lock.json')))
    .digest('hex');
  writeLocalManifest({
    deployedAt: new Date().toISOString(),
    gitSha,
    image: imageTag,
    serviceUrl,
    sourceHash,
  });

  step('8) Upload changes to git');
  if (skipGit) {
    console.log('Skipped git commit/push (--no-git).');
  } else {
    run('git', ['add', 'deploy-manifest.json']);
    const status = gitCapture(['status', '--porcelain', 'deploy-manifest.json']);
    if (!status) {
      console.log('No manifest changes to commit.');
    } else {
      const shouldSync = yesGit || await confirm('Commit and push deploy-manifest.json to git? (source code is not included)');
      if (!shouldSync) {
        console.log('Skipped git commit/push.');
      } else {
        run('git', ['commit', '-m', `chore(deploy): record production deploy ${gitSha}`]);
        run('git', ['push']);
      }
    }
  }

  const dirty = gitCapture(['status', '--porcelain']).trim();
  if (dirty) {
    console.warn('\nWARN: Uncommitted local changes remain (deploy only records deploy-manifest.json):');
    for (const line of dirty.split('\n')) console.warn(`  ${line}`);
  }

  console.log(`\nDeploy complete: ${serviceUrl}`);
  run('curl', ['-sf', `${serviceUrl}/health`], { label: 'post-deploy health check' });
  console.log('Health check passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
