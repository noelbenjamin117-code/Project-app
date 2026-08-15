import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { assertCan, can } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { getStrikeState } from '@/lib/services/strikes';
import { suggestPassword } from '@/lib/services/users';
import { MEMBERSHIP_LABEL, isPaidUp } from '@/lib/services/membership';
import { stripeConfigured } from '@/lib/stripe';
import { MemberMembershipPanel } from '@/components/member-membership-panel';
import { formatDateTime, formatDayDate } from '@/lib/time';
import { StrikeAdmin, type StrikeRowView } from '@/components/strike-admin';
import { MemberAccountPanel } from '@/components/member-account-panel';

export const dynamic = 'force-dynamic';

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect('/login');
  assertCan(user, 'viewMemberStrikes');

  const member = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, active: true },
  });
  if (!member) throw notFound('That member no longer exists.');

  const now = new Date();
  const state = await getStrikeState(member.id, now);

  // Forgiveness is an audit trail, so who did it comes along with the event.
  const details = await prisma.strikeEvent.findMany({
    where: { memberId: member.id },
    orderBy: { occurredAt: 'desc' },
    include: {
      forgivenBy: { select: { name: true } },
      booking: { include: { classInstance: { select: { name: true, startsAt: true } } } },
    },
  });

  const overrides = await prisma.suspensionOverride.findMany({
    where: { memberId: member.id },
    orderBy: { liftedAt: 'desc' },
    include: { by: { select: { name: true } } },
  });

  const rows: StrikeRowView[] = state.events.map((event) => {
    const detail = details.find((d) => d.id === event.id);
    return {
      id: event.id,
      type: event.type,
      weight: event.weight,
      occurredLabel: formatDateTime(event.occurredAt),
      classLabel: detail?.booking?.classInstance
        ? `${detail.booking.classInstance.name} · ${formatDayDate(detail.booking.classInstance.startsAt)}`
        : null,
      counting: event.counting,
      consumed: event.consumed,
      expiresLabel: formatDayDate(event.expiresAt),
      forgiven: event.forgivenAt != null,
      forgivenByName: detail?.forgivenBy?.name ?? null,
      forgivenReason: detail?.forgivenReason ?? null,
      forgivenLabel: event.forgivenAt ? formatDayDate(event.forgivenAt) : null,
    };
  });

  const attendanceCount = await prisma.booking.count({
    where: { memberId: member.id, checkedInAt: { not: null } },
  });

  const membership = await prisma.membership.findUnique({ where: { userId: member.id } });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/coach/members" className="text-sm text-white/40 hover:text-white">
          ← All members
        </Link>
        <h2 className="mt-2 text-2xl font-bold">{member.name}</h2>
        <p className="text-white/50">
          {member.email} · {member.role.toLowerCase()} · {attendanceCount} classes attended
          {!member.active && <span className="pill ml-2 bg-bad/15 text-bad">Deactivated</span>}
        </p>
      </div>

      {stripeConfigured() && (
        <MemberMembershipPanel
          userId={member.id}
          membership={{
            statusLabel: MEMBERSHIP_LABEL[membership?.status ?? 'NONE'],
            tone:
              membership?.status === 'PAST_DUE'
                ? 'warn'
                : isPaidUp(membership)
                  ? 'ok'
                  : 'bad',
            planName: membership?.planName ?? null,
            periodEndLabel: membership?.currentPeriodEnd
              ? formatDayDate(membership.currentPeriodEnd)
              : null,
            cancelAtPeriodEnd: membership?.cancelAtPeriodEnd ?? false,
            paymentFailedLabel: membership?.paymentFailedAt
              ? formatDayDate(membership.paymentFailedAt)
              : null,
            hasStripeCustomer: Boolean(membership?.stripeCustomerId),
          }}
        />
      )}

      {can(user, 'manageUsers') && (
        <MemberAccountPanel
          userId={member.id}
          role={member.role}
          active={member.active}
          isSelf={member.id === user.id}
          suggestedPassword={suggestPassword()}
        />
      )}

      {state.suspended && state.suspendedUntil && (
        <div className="card border-bad/40 bg-bad/5 p-5">
          <p className="font-semibold text-bad">Booking paused</p>
          <p className="mt-1 text-sm text-white/70">
            Since {formatDateTime(state.suspendedSince!)} · lifts automatically on{' '}
            <span className="font-semibold text-white">
              {formatDateTime(state.suspendedUntil)}
            </span>
          </p>
        </div>
      )}

      <StrikeAdmin
        memberId={member.id}
        rows={rows}
        currentWeight={state.currentWeight}
        threshold={state.threshold}
        suspended={state.suspended}
        canForgive={can(user, 'forgiveStrike')}
        canLift={can(user, 'liftSuspension')}
      />

      {overrides.length > 0 && (
        <section className="card p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/40">
            Suspension lifts
          </h3>
          <ul className="space-y-2 text-sm">
            {overrides.map((override) => (
              <li key={override.id} className="text-white/70">
                <span className="font-semibold text-white">
                  {formatDateTime(override.liftedAt)}
                </span>{' '}
                — lifted by {override.by.name}
                {override.reason && ` · "${override.reason}"`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
