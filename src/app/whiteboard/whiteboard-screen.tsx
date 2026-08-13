'use client';

import { useEffect, useRef, useState } from 'react';
import { gymConfig } from '~/gym.config';
import type { WhiteboardPayload } from '@/app/api/whiteboard/route';

const POLL_MS = gymConfig.whiteboard.pollSeconds * 1000;
const HARD_RELOAD_MS = gymConfig.whiteboard.hardReloadHours * 3600 * 1000;

/**
 * The gym TV. This tab is opened once and then left alone for weeks, so the
 * refresh loop is written for that lifetime rather than for a page someone
 * closes after five minutes:
 *
 *  - One interval, cleared on unmount. No nested or re-registered timers.
 *  - Each tick replaces state wholesale — nothing accumulates in memory, and
 *    the DOM stays the same size whether the board has run for a minute or a
 *    month.
 *  - In-flight requests are aborted before a new one starts, so a slow network
 *    cannot pile up overlapping fetches.
 *  - A full reload every few hours, and immediately when the gym-local date
 *    rolls over, which also picks up any deploy that happened overnight.
 *  - A failed poll keeps the last good board on screen instead of blanking the
 *    TV; it just marks itself stale.
 */
export function WhiteboardScreen() {
  const [data, setData] = useState<WhiteboardPayload | null>(null);
  const [stale, setStale] = useState(false);
  const mountedAt = useRef(Date.now());
  const currentDate = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const poll = async () => {
      controller?.abort();
      controller = new AbortController();

      try {
        const response = await fetch('/api/whiteboard', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(String(response.status));
        const payload: WhiteboardPayload = await response.json();
        if (cancelled) return;

        // New gym-local day, or a long-running tab: start clean.
        if (currentDate.current && payload.date !== currentDate.current) {
          window.location.reload();
          return;
        }
        if (Date.now() - mountedAt.current > HARD_RELOAD_MS) {
          window.location.reload();
          return;
        }

        currentDate.current = payload.date;
        setData(payload);
        setStale(false);
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        // Keep showing the last good board — a blank TV is worse than an old one.
        if (!cancelled) setStale(true);
      }
    };

    void poll();
    const timer = window.setInterval(poll, POLL_MS);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  if (!data) {
    return (
      <div className="flex h-dvh items-center justify-center bg-black text-tv text-white/40">
        Loading the board…
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-black text-white">
      <header className="flex shrink-0 items-baseline justify-between border-b-4 border-brand px-10 py-5">
        <h1 className="text-tv-lg font-black uppercase tracking-tight">{data.gymName}</h1>
        <p className="text-tv font-bold text-white/50">
          {stale && <span className="mr-4 text-warn">reconnecting…</span>}
          {data.generatedAtLabel}
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-[3] flex-col gap-6 overflow-hidden p-10">
          {data.wods.length === 0 ? (
            <p className="text-tv-lg text-white/30">Nothing programmed today.</p>
          ) : (
            data.wods.slice(0, 1).map((wod) => (
              <div key={wod.id} className="flex min-h-0 flex-1 gap-10">
                <div className="min-w-0 flex-1">
                  <p className="text-tv font-bold uppercase tracking-widest text-brand">
                    {wod.typeLabel}
                  </p>
                  <h2 className="mt-1 text-tv-xl font-black leading-none">{wod.name}</h2>

                  {/* Pre-line keeps the coach's line breaks; the WOD is read as
                      written on the board, not reflowed into a paragraph. */}
                  <p className="mt-6 whitespace-pre-line text-tv-lg font-semibold leading-tight">
                    {wod.description}
                  </p>

                  {wod.notes && (
                    <p className="mt-6 text-tv text-white/60">{wod.notes}</p>
                  )}

                  {wod.scaling.length > 0 && (
                    <dl className="mt-8 space-y-3 border-t-2 border-white/15 pt-6">
                      {wod.scaling.map((option) => (
                        <div key={option.label} className="flex gap-6 text-tv">
                          <dt className="w-32 shrink-0 font-black text-brand">{option.label}</dt>
                          <dd className="min-w-0 text-white/80">{option.description}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>

                <div className="flex w-[38%] shrink-0 flex-col">
                  <h3 className="text-tv font-black uppercase tracking-widest text-white/40">
                    Today's board
                  </h3>
                  {wod.board.length === 0 ? (
                    <p className="mt-6 text-tv text-white/25">No scores yet</p>
                  ) : (
                    <ol className="mt-4 min-h-0 flex-1 space-y-2 overflow-hidden">
                      {wod.board.map((row) => (
                        <li
                          key={`${row.rank}-${row.name}`}
                          className="flex items-baseline gap-4 border-b border-white/10 pb-2 text-tv"
                        >
                          <span className="w-12 shrink-0 font-black text-white/30">
                            {row.rank}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-bold">
                            {row.name}
                            {row.isPr && <span className="ml-3 text-brand">PR</span>}
                          </span>
                          <span className="shrink-0 text-white/40">{row.scalingLabel}</span>
                          <span className="w-40 shrink-0 text-right font-mono font-black">
                            {row.scoreLabel}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            ))
          )}
        </section>

        <aside className="flex w-[22%] shrink-0 flex-col gap-4 border-l-2 border-white/15 bg-white/[0.03] p-8">
          <h3 className="text-tv font-black uppercase tracking-widest text-white/40">Next up</h3>
          {data.upcoming.length === 0 ? (
            <p className="text-tv text-white/25">Done for today</p>
          ) : (
            data.upcoming.map((cls) => (
              <div key={cls.id} className="border-b border-white/10 pb-4">
                <p className="text-tv-lg font-black leading-none">{cls.timeLabel}</p>
                <p className="mt-1 text-tv text-white/50">{cls.coachName ?? cls.name}</p>
                <p className="text-tv font-bold text-brand">{cls.spotsLabel}</p>
              </div>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}
