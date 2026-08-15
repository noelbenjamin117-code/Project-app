import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { assertCan } from '@/lib/permissions';
import { getMigrationOverview } from '@/lib/services/migration';
import { appUrl } from '@/lib/stripe';
import { formatDayDate } from '@/lib/time';
import { MigrationDashboard, type MigrationRowView } from '@/components/migration-dashboard';

export const dynamic = 'force-dynamic';

export default async function MigrationPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  assertCan(user, 'manageUsers');

  const overview = await getMigrationOverview(user, appUrl());

  const rows: MigrationRowView[] = overview.rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    legacyPlan: row.legacyPlan,
    state: row.state,
    claimedLabel: row.claimedAt ? formatDayDate(row.claimedAt) : null,
    sentCount: row.sentCount,
    lastSentLabel: row.lastSentAt ? formatDayDate(row.lastSentAt) : null,
    graceUntilLabel: row.graceUntil ? formatDayDate(row.graceUntil) : null,
    claimUrl: row.claimUrl,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Migration</h2>
        <p className="mt-1 text-white/50">
          Bringing members across. The ones who have claimed but haven't paid are listed first —
          they're the ones costing you money.
        </p>
      </div>

      <MigrationDashboard rows={rows} counts={overview.counts} />
    </div>
  );
}
