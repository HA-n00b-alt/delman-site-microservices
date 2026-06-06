/**
 * Compare local deploy env contract against Cloud Run runtime env.
 * Local files are the source of truth; remote-only values are errors.
 */
export function auditDeploySecrets(localEnv, remoteEnv, requiredKeys) {
  const issues = [];

  for (const key of requiredKeys) {
    const local = (localEnv[key] ?? '').trim();
    const remote = (remoteEnv[key] ?? '').trim();

    if (!local && remote) {
      issues.push({
        severity: 'error',
        key,
        message:
          `${key} exists on Cloud Run but is missing in .env / .secrets.env. ` +
          'Add the intended value locally or remove the stale variable from Cloud Run before deploying.',
      });
      continue;
    }

    if (!local && !remote) {
      issues.push({
        severity: 'error',
        key,
        message: `${key} is missing locally and on Cloud Run.`,
      });
      continue;
    }

    if (local && remote && local !== remote) {
      issues.push({
        severity: 'warn',
        key,
        message: `${key} differs between local env files and Cloud Run. Deploy will overwrite the remote value.`,
      });
    }
  }

  for (const key of Object.keys(remoteEnv)) {
    if (requiredKeys.includes(key)) continue;
    issues.push({
      severity: 'error',
      key,
      message:
        `${key} is set on Cloud Run but is not part of the local deploy contract. ` +
        'Remove it from Cloud Run if it is obsolete.',
    });
  }

  return issues;
}

export function printDeploySecretIssues(issues) {
  for (const issue of issues) {
    const prefix = issue.severity === 'error' ? 'ERROR' : 'WARN';
    console.error(`${prefix}: ${issue.message}`);
  }
}

export function hasDeploySecretErrors(issues) {
  return issues.some((issue) => issue.severity === 'error');
}
