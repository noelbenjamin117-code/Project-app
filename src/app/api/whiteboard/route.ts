import { NextResponse } from 'next/server';
import { gymConfig } from '~/gym.config';
import { getWhiteboardData } from '@/lib/services/classes';
import { getLeaderboard } from '@/lib/services/results';
import { formatScore, SCALING_LABEL, SCALING_ORDER, WOD_TYPE_LABEL } from '@/lib/domain/scoring';
import { formatTime, todayLocal } from '@/lib/time';

export const dynamic = 'force-dynamic';

export interface WhiteboardPayload {
  /** Gym-local date this payload describes; the TV reloads when it changes. */
  date: string;
  generatedAtLabel: string;
  gymName: string;
  wods: Array<{
    id: string;
    name: string;
    typeLabel: string;
    description: string;
    notes: string | null;
    scaling: Array<{ label: string; description: string }>;
    board: Array<{
      rank: number;
      name: string;
      scoreLabel: string;
      scalingLabel: string;
      isPr: boolean;
    }>;
  }>;
  upcoming: Array<{
    id: string;
    name: string;
    timeLabel: string;
    coachName: string | null;
    spotsLabel: string;
  }>;
}

/**
 * Everything the gym TV shows, as one flat, already-formatted payload.
 *
 * All formatting happens here rather than on the TV: the panel is a browser
 * left running for weeks in an unknown locale, and it should never be
 * responsible for working out what "6:00am" means.
 *
 * Public by design — the whiteboard has no login, and shows only what is
 * already written on a physical whiteboard in the room.
 */
export async function GET() {
  const now = new Date();
  const data = await getWhiteboardData(now);

  const boards = await Promise.all(
    data.scheduled.map((item) => getLeaderboard(item.id)),
  );

  const payload: WhiteboardPayload = {
    date: todayLocal(now),
    generatedAtLabel: formatTime(now),
    gymName: gymConfig.name,
    wods: data.scheduled.map((item, index) => ({
      id: item.id,
      name: item.wodDefinition.name ?? 'Workout of the day',
      typeLabel: WOD_TYPE_LABEL[item.wodDefinition.type],
      description: item.wodDefinition.description,
      notes: item.notes,
      scaling: SCALING_ORDER.flatMap((level) => {
        const option = item.wodDefinition.scalingOptions.find((o) => o.level === level);
        return option ? [{ label: SCALING_LABEL[level], description: option.description }] : [];
      }),
      board: boards[index].rows.slice(0, gymConfig.whiteboard.leaderboardRows).map((row) => ({
        rank: row.rank,
        name: boardName(row.memberName),
        scoreLabel: formatScore(boards[index].scoreType, row.score, boards[index].timeCapSeconds),
        scalingLabel: SCALING_LABEL[row.scalingLevel],
        isPr: row.isPr,
      })),
    })),
    upcoming: data.upcoming.map((cls) => ({
      id: cls.id,
      name: cls.name,
      timeLabel: formatTime(cls.startsAt),
      coachName: cls.coachName,
      spotsLabel: spotsLabel(cls.capacity - cls.bookedCount),
    })),
  };

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * "Nora Fitzgerald" -> "Nora F." — the way names are actually written on a
 * gym whiteboard. Full surnames overflow the column at TV type sizes and get
 * truncated to an ellipsis, which is unreadable from across the room.
 */
function boardName(fullName: string): string {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}.` : first;
}

function spotsLabel(spotsLeft: number): string {
  if (spotsLeft <= 0) return 'Full';
  return spotsLeft === 1 ? '1 spot' : `${spotsLeft} spots`;
}
