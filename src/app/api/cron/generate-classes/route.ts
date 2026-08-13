import { NextResponse } from 'next/server';
import { ensureHorizon } from '@/lib/services/schedule';

export const dynamic = 'force-dynamic';
// Prisma needs the Node runtime, not the edge one.
export const runtime = 'nodejs';

/**
 * Daily top-up of the class booking horizon, triggered by Vercel Cron.
 *
 * The app also calls ensureHorizon() whenever anyone opens the schedule, so
 * this is really a safety net for a quiet week. Generation is idempotent, so
 * running it twice in a day changes nothing.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when that variable is set.
 * If it is not set we still allow the call: generation is harmless and
 * non-destructive, and refusing would silently break the schedule for anyone
 * who skipped that step.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    await ensureHorizon();
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
  } catch (error) {
    console.error('Class generation failed', error);
    return NextResponse.json({ ok: false, error: 'Generation failed' }, { status: 500 });
  }
}
