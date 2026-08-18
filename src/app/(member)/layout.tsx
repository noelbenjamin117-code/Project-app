import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { atLeast } from '@/lib/permissions';
import { getStrikeState } from '@/lib/services/strikes';
import { getMembershipState } from '@/lib/services/membership';
import { stripeConfigured } from '@/lib/stripe';
import { formatDateTime } from '@/lib/time';
import { StrikeBanner, MembershipBanner } from '@/components/strike-banner';
import { MemberNav } from '@/components/member-nav';
import { ServiceWorkerRegistrar } from '@/components/service-worker';
import { signOut } from '@/app/actions/auth';
import { Wordmark } from '@/components/wordmark';

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Coaches use this surface too — they book and log scores like everyone else.
  const strikeState = await getStrikeState(user.id);
  const membershipState = stripeConfigured() ? await getMembershipState(user.id) : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <ServiceWorkerRegistrar />
      <header className="flex items-center justify-between px-5 pb-3 pt-6">
        <div>
          <Wordmark />
          <h1 className="text-xl font-bold">{user.name.split(' ')[0]}</h1>
        </div>
        <div className="flex items-center gap-2">
          {atLeast(user.role, 'COACH') && (
            <Link href="/coach" className="btn-secondary px-3 py-2 text-xs">
              Coach view
            </Link>
          )}
          <form action={signOut}>
            <button type="submit" className="btn-secondary px-3 py-2 text-xs">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {membershipState && (
        <MembershipBanner
          state={membershipState}
          graceEndsLabel={
            membershipState.graceEndsAt ? formatDateTime(membershipState.graceEndsAt) : null
          }
        />
      )}

      {/* Persistent — a member one strike from suspension is told on every
          screen, not only at the moment they cancel. */}
      <StrikeBanner state={strikeState} />

      <main className="flex-1 px-5 pb-28">{children}</main>

      <MemberNav />
    </div>
  );
}
