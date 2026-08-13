import type { ConfigProblem } from '@/lib/config-check';

/**
 * Shown instead of the sign-in or setup form when the deployment is missing
 * something essential. Names the variable and the fix, and deliberately never
 * prints any value.
 */
export function ConfigProblems({ problems }: { problems: ConfigProblem[] }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
      <div className="card border-bad/40 bg-bad/5 p-6">
        <h1 className="text-xl font-bold text-bad">This deployment isn't finished</h1>
        <p className="mt-2 text-white/70">
          {problems.length === 1
            ? 'One environment variable is missing or invalid, so signing in cannot work yet.'
            : `${problems.length} environment variables are missing or invalid, so signing in cannot work yet.`}
        </p>

        <ul className="mt-5 space-y-4">
          {problems.map((problem) => (
            <li key={problem.variable} className="rounded-lg bg-ink p-4">
              <p className="font-mono font-semibold text-white">
                {problem.variable}{' '}
                <span className="font-sans font-normal text-bad">{problem.problem}</span>
              </p>
              <p className="mt-1 text-sm text-white/60">{problem.fix}</p>
            </li>
          ))}
        </ul>

        <div className="mt-6 border-t border-edge pt-5 text-sm text-white/60">
          <p className="font-semibold text-white">To fix it on Vercel</p>
          <ol className="mt-2 list-inside list-decimal space-y-1">
            <li>Project → Settings → Environment Variables</li>
            <li>
              Add the variable above, ticking <strong>Production</strong>,{' '}
              <strong>Preview</strong> and <strong>Development</strong>
            </li>
            <li>Deployments → the most recent one → ⋯ → Redeploy</li>
          </ol>
          <p className="mt-3 text-white/40">
            Nothing has been saved, so it is safe to come back to this page once the redeploy
            finishes.
          </p>
        </div>
      </div>
    </main>
  );
}
