/**
 * Deployment configuration checks.
 *
 * These exist because a missing SESSION_SECRET fails in the worst possible
 * way: the app looks healthy, the setup form accepts your details, the owner
 * account is written to the database — and only then does signing in throw,
 * leaving you locked out of a gym that now refuses to be set up again.
 *
 * Better to say so plainly on the page before anyone fills anything in.
 */

export interface ConfigProblem {
  variable: string;
  problem: string;
  fix: string;
}

const MIN_SECRET_LENGTH = 32;

export function serverConfigProblems(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    problems.push({
      variable: 'SESSION_SECRET',
      problem: 'is not set',
      fix: `Add it with at least ${MIN_SECRET_LENGTH} random characters. Without it nobody can sign in.`,
    });
  } else if (secret.length < MIN_SECRET_LENGTH) {
    problems.push({
      variable: 'SESSION_SECRET',
      problem: `is only ${secret.length} characters`,
      fix: `It needs at least ${MIN_SECRET_LENGTH}. Replace it with a longer random string.`,
    });
  }

  if (!process.env.DATABASE_URL) {
    problems.push({
      variable: 'DATABASE_URL',
      problem: 'is not set',
      fix: 'Paste the pooled connection string from your database provider.',
    });
  }

  return problems;
}

/** True when the app is missing something it cannot work without. */
export function hasBlockingConfigProblem(): boolean {
  return serverConfigProblems().length > 0;
}
