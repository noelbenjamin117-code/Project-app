import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getScheduledWodsForDate } from '@/lib/services/programming';
import { getLeaderboard } from '@/lib/services/results';
import { todayLocal, formatDayDate } from '@/lib/time';
import { DateTime } from 'luxon';
import { GYM_TZ } from '@/lib/time';
import { SCALING_LABEL, WOD_TYPE_LABEL, formatScore } from '@/lib/domain/scoring';
import { LogScoreForm } from '@/components/log-score-form';
import { Leaderboard } from '@/components/leaderboard';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const today = todayLocal();
  const scheduled = await getScheduledWodsForDate(today);

  if (scheduled.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Today</h2>
        <p className="card p-6 text-center text-white/50">
          Nothing programmed for {formatDayDate(DateTime.fromISO(today, { zone: GYM_TZ }).toJSDate())} yet.
        </p>
      </div>
    );
  }

  const myResults = await prisma.result.findMany({
    where: { memberId: user.id, scheduledWodId: { in: scheduled.map((s) => s.id) } },
  });

  // Resolve the boards up front rather than awaiting inside JSX.
  const boards = await Promise.all(scheduled.map((item) => getLeaderboard(item.id)));

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Today</h2>

      {scheduled.map((item, index) => {
        const board = boards[index];
        const mine = myResults.find((r) => r.scheduledWodId === item.id);

        return (
          <section key={item.id} className="space-y-3">
            <div className="card p-5">
              <div className="flex items-center gap-2">
                <span className="pill bg-brand/15 text-brand">
                  {WOD_TYPE_LABEL[item.wodDefinition.type]}
                </span>
                {item.wodDefinition.isBenchmark && (
                  <span className="pill bg-white/10 text-white/60">Benchmark</span>
                )}
              </div>

              <h3 className="mt-2 text-xl font-bold">
                {item.wodDefinition.name ?? 'Workout of the day'}
              </h3>

              {/* Whitespace-pre-line so a coach's line breaks survive. */}
              <p className="mt-2 whitespace-pre-line text-white/80">
                {item.wodDefinition.description}
              </p>

              {item.notes && <p className="mt-3 text-sm text-white/50">{item.notes}</p>}

              {item.wodDefinition.scalingOptions.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-edge pt-4">
                  {item.wodDefinition.scalingOptions.map((option) => (
                    <div key={option.id} className="flex gap-3 text-sm">
                      <span className="w-16 shrink-0 font-semibold text-brand">
                        {SCALING_LABEL[option.level]}
                      </span>
                      <span className="text-white/70">{option.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {mine ? (
              <div className="card border-ok/40 p-4">
                <p className="text-sm text-white/50">Your score</p>
                <p className="text-2xl font-bold">
                  {formatScore(
                    item.wodDefinition.scoreType,
                    mine,
                    item.wodDefinition.timeCapSeconds,
                  )}
                  <span className="ml-2 text-sm font-normal text-white/50">
                    {SCALING_LABEL[mine.scalingLevel]}
                  </span>
                  {mine.isPr && <span className="pill ml-2 bg-brand/20 text-brand">PR</span>}
                </p>
                <LogScoreForm
                  wodDefinitionId={item.wodDefinitionId}
                  scheduledWodId={item.id}
                  scoreType={item.wodDefinition.scoreType}
                  timeCapSeconds={item.wodDefinition.timeCapSeconds}
                  availableLevels={item.wodDefinition.scalingOptions.map((o) => o.level)}
                  existing={{
                    scalingLevel: mine.scalingLevel,
                    timeSeconds: mine.timeSeconds,
                    rounds: mine.rounds,
                    reps: mine.reps,
                    loadKg: mine.loadKg,
                    cappedOut: mine.cappedOut,
                    capReps: mine.capReps,
                    notes: mine.notes,
                  }}
                />
              </div>
            ) : (
              <LogScoreForm
                wodDefinitionId={item.wodDefinitionId}
                scheduledWodId={item.id}
                scoreType={item.wodDefinition.scoreType}
                timeCapSeconds={item.wodDefinition.timeCapSeconds}
                availableLevels={item.wodDefinition.scalingOptions.map((o) => o.level)}
              />
            )}

            <Leaderboard
              rows={board.rows}
              scoreType={board.scoreType}
              timeCapSeconds={board.timeCapSeconds}
              highlightMemberId={user.id}
            />
          </section>
        );
      })}
    </div>
  );
}
