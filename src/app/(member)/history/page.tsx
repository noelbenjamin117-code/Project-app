import { redirect } from 'next/navigation';
import { DateTime } from 'luxon';
import { getSessionUser } from '@/lib/auth';
import { getMemberHistory, getMemberPrs } from '@/lib/services/results';
import { GYM_TZ } from '@/lib/time';
import {
  SCALING_LABEL,
  describeScore,
  estimateOneRepMax,
  formatScore,
} from '@/lib/domain/scoring';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const [history, prs] = await Promise.all([
    getMemberHistory(user, user.id),
    getMemberPrs(user, user.id),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Your history</h2>

      {(prs.wodPrs.length > 0 || prs.liftPrs.length > 0) && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/40">
            Personal bests
          </h3>
          <div className="card divide-y divide-edge">
            {prs.wodPrs.map((pr) => (
              <div key={pr.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {pr.wodDefinition.name}
                  <span className="ml-2 text-xs font-normal text-white/40">
                    {SCALING_LABEL[pr.scalingLevel]}
                  </span>
                </span>
                <span className="font-mono font-bold text-brand">
                  {formatScore(pr.wodDefinition.scoreType, pr, pr.wodDefinition.timeCapSeconds)}
                </span>
              </div>
            ))}

            {prs.liftPrs.map((pr) => (
              <div key={pr.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {pr.movement.name}
                  {/* A 3RM and a 1RM are separate records, so the rep scheme is
                      part of the name of the PR, not a footnote. */}
                  <span className="ml-2 text-xs font-normal text-white/40">
                    {pr.reps}RM
                  </span>
                </span>
                <span className="text-right">
                  <span className="font-mono font-bold text-brand">{pr.loadKg} kg</span>
                  {pr.reps > 1 && (
                    <span className="block text-xs text-white/40">
                      ~{estimateOneRepMax(pr.loadKg, pr.reps)} kg e1RM
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-white/40">
          Everything you've logged
        </h3>

        {history.length === 0 ? (
          <p className="card p-6 text-center text-white/50">
            No scores yet. Log one from the Today tab.
          </p>
        ) : (
          <ul className="space-y-2">
            {history.map((result) => (
              <li key={result.id} className="card px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {result.wodDefinition.name ?? 'Workout'}
                      {result.isPr && <span className="pill ml-2 bg-brand/20 text-brand">PR</span>}
                    </p>
                    <p className="text-sm text-white/50">
                      {DateTime.fromISO(result.performedOn, { zone: GYM_TZ }).toFormat('ccc d LLL')}
                      {' · '}
                      {SCALING_LABEL[result.scalingLevel]}
                      {!result.classInstanceId && ' · logged outside class'}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono font-semibold">
                    {describeScore(
                      result.wodDefinition.scoreType,
                      result,
                      result.wodDefinition.timeCapSeconds,
                    )}
                  </span>
                </div>

                {result.notes && <p className="mt-1.5 text-sm text-white/50">{result.notes}</p>}

                {result.liftResults.length > 0 && (
                  <p className="mt-1.5 text-sm text-white/50">
                    {result.liftResults
                      .map((l) => `${l.movement.name} ${l.reps}x${l.loadKg}kg`)
                      .join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
