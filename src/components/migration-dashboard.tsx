'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import {
  exportClaimLinksAction,
  importMembersAction,
  regenerateClaimAction,
  type ImportSummaryView,
} from '@/app/actions/migration';

export type MigrationState = 'NOT_CLAIMED' | 'CLAIMED_NOT_PAID' | 'CLAIMED_AND_PAID';

export interface MigrationRowView {
  userId: string;
  name: string;
  email: string;
  legacyPlan: string | null;
  state: MigrationState;
  claimedLabel: string | null;
  sentCount: number;
  lastSentLabel: string | null;
  graceUntilLabel: string | null;
  claimUrl: string | null;
}

const STATE_LABEL: Record<MigrationState, string> = {
  CLAIMED_NOT_PAID: 'Claimed, not paid',
  NOT_CLAIMED: "Hasn't claimed",
  CLAIMED_AND_PAID: 'Claimed and paid',
};

const STATE_STYLE: Record<MigrationState, string> = {
  CLAIMED_NOT_PAID: 'bg-warn/15 text-warn',
  NOT_CLAIMED: 'bg-bad/15 text-bad',
  CLAIMED_AND_PAID: 'bg-ok/15 text-ok',
};

export function MigrationDashboard({
  rows,
  counts,
}: {
  rows: MigrationRowView[];
  counts: Record<MigrationState, number>;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<MigrationState | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<ImportSummaryView | null>(null);
  const [csv, setCsv] = useState('');
  const [graceDays, setGraceDays] = useState(30);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (filter === 'ALL' || row.state === filter) &&
        (!term ||
          row.name.toLowerCase().includes(term) ||
          row.email.toLowerCase().includes(term)),
    );
  }, [rows, filter, search]);

  const runImport = (dryRun: boolean) =>
    startTransition(async () => {
      const result = await importMembersAction(csv, { graceDays, skipDropIns: true, dryRun });
      if (result.error) {
        setFeedback({ ok: false, text: result.error });
        setSummary(null);
        return;
      }
      setSummary(result.summary ?? null);
      setFeedback(
        dryRun
          ? { ok: true, text: 'Preview only — nothing was created.' }
          : { ok: true, text: 'Import finished.' },
      );
    });

  const downloadLinks = () =>
    startTransition(async () => {
      const result = await exportClaimLinksAction(true);
      if (result.error || !result.csv) {
        setFeedback({ ok: false, text: result.error ?? 'Could not build the file.' });
        return;
      }
      // A data: URL rather than a server download, so nothing is written to disk.
      const blob = new Blob([result.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'claim-links.csv';
      link.click();
      URL.revokeObjectURL(url);
      setFeedback({ ok: true, text: 'Downloaded. Send these through your usual mailing tool.' });
    });

  return (
    <div className="space-y-6">
      {feedback && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${
            feedback.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'
          }`}
        >
          {feedback.text}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {(['CLAIMED_NOT_PAID', 'NOT_CLAIMED', 'CLAIMED_AND_PAID'] as const).map((state) => (
          <button
            key={state}
            onClick={() => setFilter(filter === state ? 'ALL' : state)}
            className={`card p-4 text-left transition-colors ${
              filter === state ? 'border-brand' : 'hover:border-white/30'
            }`}
          >
            <p className="text-3xl font-bold">{counts[state]}</p>
            <p className="mt-1 text-sm text-white/50">{STATE_LABEL[state]}</p>
          </button>
        ))}
      </div>

      <section className="card p-5">
        <h3 className="font-semibold">Import members</h3>
        <p className="mt-1 text-sm text-white/50">
          Paste your export. Only name, email, phone and which plan they were on are taken —
          date of birth, address and emergency contacts are left in the file, because this app
          has no use for them.
        </p>

        <textarea
          className="input mt-3 min-h-32 font-mono text-xs"
          placeholder="Name,Email,Phone Number,Primary Product&#10;Jamie Fitzgerald,jamie@example.com,07700900000,B42 Tier 1"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="grace">
              Give everyone this many days to pay
            </label>
            <input
              id="grace"
              className="input w-40"
              type="number"
              min={0}
              max={90}
              value={graceDays}
              onChange={(e) => setGraceDays(Number(e.target.value))}
            />
          </div>
          <button
            className="btn-secondary"
            disabled={pending || !csv.trim()}
            onClick={() => runImport(true)}
          >
            Preview
          </button>
          <button
            className="btn-primary"
            disabled={pending || !csv.trim()}
            onClick={() => runImport(false)}
          >
            {pending ? 'Working…' : 'Import'}
          </button>
        </div>

        <p className="mt-2 text-xs text-white/40">
          Booking needs an active membership, so everyone imported gets that many days of grace.
          They can train from day one and pay in their own time.
        </p>

        {summary && (
          <div className="mt-4 rounded-lg border border-edge bg-ink p-4 text-sm">
            <p className="font-semibold">
              {summary.parsed} rows read · {summary.created} created ·{' '}
              {summary.alreadyExisted} already here · {summary.skippedDropIns} drop-ins skipped
            </p>

            {summary.headers.length > 0 && (
              <p className="mt-2 text-xs text-white/40">
                Columns seen: {summary.headers.join(', ')}
              </p>
            )}

            {summary.preview.length > 0 && (
              <ul className="mt-3 space-y-0.5 text-xs text-white/60">
                {summary.preview.map((row) => (
                  <li key={row.email}>
                    {row.name} · {row.email}
                    {row.legacyPlan && ` · ${row.legacyPlan}`}
                  </li>
                ))}
              </ul>
            )}

            {summary.problems.length > 0 && (
              <div className="mt-3">
                <p className="font-semibold text-warn">
                  {summary.problems.length} rows need a look
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-warn/80">
                  {summary.problems.slice(0, 10).map((problem, index) => (
                    <li key={index}>
                      Line {problem.line}: {problem.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Claim links</h3>
            <p className="mt-1 text-sm text-white/50">
              Download and send through whatever already reaches your members. The app doesn't
              email them itself — a new sending domain mailing everyone at once tends to land in
              spam on exactly the wrong day.
            </p>
          </div>
          <button className="btn-primary shrink-0" disabled={pending} onClick={downloadLinks}>
            Download unclaimed
          </button>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-3">
          <h3 className="font-semibold">
            {visible.length} {filter === 'ALL' ? 'members' : STATE_LABEL[filter].toLowerCase()}
          </h3>
          <input
            className="input ml-auto w-56"
            placeholder="Search name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {filter !== 'ALL' && (
            <button className="text-xs text-white/40 underline" onClick={() => setFilter('ALL')}>
              Clear filter
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-white/40">
            Nobody here. Import your members above to get started.
          </p>
        ) : (
          <ul className="divide-y divide-edge">
            {visible.map((row) => (
              <li key={row.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/coach/members/${row.userId}`}
                    className="font-semibold hover:text-brand"
                  >
                    {row.name}
                  </Link>
                  <p className="truncate text-sm text-white/40">
                    {row.email}
                    {row.legacyPlan && ` · was on ${row.legacyPlan}`}
                  </p>
                </div>

                <div className="text-right text-xs text-white/40">
                  {row.claimedLabel && <p>Claimed {row.claimedLabel}</p>}
                  {row.graceUntilLabel && <p>Grace until {row.graceUntilLabel}</p>}
                  {!row.claimedLabel && row.sentCount > 0 && (
                    <p>
                      Sent {row.sentCount}× {row.lastSentLabel && `· ${row.lastSentLabel}`}
                    </p>
                  )}
                </div>

                <span className={`pill shrink-0 ${STATE_STYLE[row.state]}`}>
                  {STATE_LABEL[row.state]}
                </span>

                {row.state === 'NOT_CLAIMED' && (
                  <button
                    className="btn-secondary shrink-0 px-3 py-2 text-xs"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await regenerateClaimAction(row.userId);
                        setFeedback({
                          ok: result.ok,
                          text: result.error ?? result.message ?? '',
                        });
                      })
                    }
                  >
                    New link
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
