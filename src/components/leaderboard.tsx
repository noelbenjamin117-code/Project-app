'use client';

import { useState } from 'react';
import type { ScoreType } from '@prisma/client';
import { SCALING_LABEL, SCALING_ORDER, formatScore } from '@/lib/domain/scoring';
import type { ScalingLevel } from '@/lib/domain/scoring';
import type { LeaderboardRow } from '@/lib/services/results';

/**
 * Leaderboards are always read within a scaling level — an Rx time and a
 * Scaled time are different workouts. The filter defaults to "all", grouped so
 * the levels never blend into one ranking.
 */
export function Leaderboard({
  rows,
  scoreType,
  timeCapSeconds,
  highlightMemberId,
  title = 'Leaderboard',
}: {
  rows: LeaderboardRow[];
  scoreType: ScoreType;
  timeCapSeconds: number | null;
  highlightMemberId?: string;
  title?: string;
}) {
  const [filter, setFilter] = useState<ScalingLevel | 'ALL'>('ALL');

  const present = SCALING_ORDER.filter((level) => rows.some((r) => r.scalingLevel === level));
  const visible = filter === 'ALL' ? present : present.filter((l) => l === filter);

  if (rows.length === 0) {
    return (
      <div className="card p-5 text-center text-sm text-white/40">
        No scores yet. Be the first on the board.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h4 className="font-semibold">{title}</h4>
        <div className="flex gap-1">
          {(['ALL', ...present] as const).map((option) => (
            <button
              key={option}
              onClick={() => setFilter(option)}
              className={`rounded-md px-2 py-1 text-xs font-semibold ${
                filter === option ? 'bg-brand/20 text-brand' : 'text-white/40'
              }`}
            >
              {option === 'ALL' ? 'All' : SCALING_LABEL[option]}
            </button>
          ))}
        </div>
      </div>

      {visible.map((level) => {
        const levelRows = rows
          .filter((r) => r.scalingLevel === level)
          // Ranks arrive computed across the whole board; renumber within the
          // level so each group reads 1, 2, 3.
          .map((row, index, all) => ({
            ...row,
            displayRank:
              index > 0 && sameScore(scoreType, row, all[index - 1]) ? undefined : index + 1,
          }));

        return (
          <div key={level}>
            <p className="bg-white/[0.03] px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-white/40">
              {SCALING_LABEL[level]}
            </p>
            <ul>
              {levelRows.map((row, index) => (
                <li
                  key={row.resultId}
                  className={`flex items-center gap-3 border-t border-edge px-4 py-2.5 ${
                    row.memberId === highlightMemberId ? 'bg-brand/5' : ''
                  }`}
                >
                  <span className="w-6 shrink-0 text-sm font-bold text-white/40">
                    {row.displayRank ?? index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {row.memberName}
                    {row.isPr && <span className="pill ml-2 bg-brand/20 text-brand">PR</span>}
                  </span>
                  <span className="shrink-0 font-mono font-semibold">
                    {formatScore(scoreType, row.score, timeCapSeconds)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function sameScore(scoreType: ScoreType, a: LeaderboardRow, b: LeaderboardRow): boolean {
  return formatScore(scoreType, a.score) === formatScore(scoreType, b.score);
}
