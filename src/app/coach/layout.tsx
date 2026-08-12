import Link from 'next/link';
import { redirect } from 'next/navigation';
import { gymConfig } from '~/gym.config';
import { getSessionUser } from '@/lib/auth';
import { atLeast } from '@/lib/permissions';
import { signOut } from '@/app/actions/auth';
import { CoachNav } from '@/components/coach-nav';

/**
 * The coach/owner surface is desktop-first: it is used on the gym laptop to
 * run a roster and programme the week.
 *
 * This layout is a guard as well as a shell — but the real enforcement is in
 * the actions, which re-check permissions on every mutation.
 */
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!atLeast(user.role, 'COACH')) redirect('/schedule');

  return (
    <div className="min-h-dvh">
      <header className="border-b border-edge bg-panel">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-baseline gap-6">
            <Link href="/coach" className="shrink-0">
              <span className="text-xs font-semibold uppercase tracking-widest text-brand">
                {gymConfig.shortName}
              </span>
              <span className="ml-2 font-bold">Coach</span>
            </Link>
            <CoachNav />
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-white/50">
              {user.name} · {user.role.toLowerCase()}
            </span>
            <Link href="/schedule" className="btn-secondary px-3 py-2 text-xs">
              Member view
            </Link>
            <form action={signOut}>
              <button type="submit" className="btn-secondary px-3 py-2 text-xs">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
