import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { assertCan, can } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { getStrikeStates } from '@/lib/services/strikes';
import { suggestPassword } from '@/lib/services/users';
import { formatDayDate } from '@/lib/time';
import { AddMemberPanel } from '@/components/add-member-panel';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  assertCan(user, 'viewMemberStrikes');

  const members = await prisma.user.findMany({
    where: { active: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, email: true, role: true },
  });

  const states = await getStrikeStates(members.map((m) => m.id));

  // Anyone suspended or close to it floats to the top — that is what a coach
  // opens this page to find.
  const sorted = members.slice().sort((a, b) => {
    const sa = states.get(a.id)!;
    const sb = states.get(b.id)!;
    const rank = (s: typeof sa) => (s.suspended ? 0 : s.currentWeight > 0 ? 1 : 2);
    return rank(sa) - rank(sb) || sb.currentWeight - sa.currentWeight || a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Members</h2>
          <p className="text-sm text-white/50">
            {members.length} active · anyone at or near their strike limit is listed first.
          </p>
        </div>
        {can(user, 'manageUsers') && <AddMemberPanel suggestedPassword={suggestPassword()} />}
      </div>

      <div className="card overflow-hidden">
        <ul className="divide-y divide-edge">
          {sorted.map((member) => {
            const state = states.get(member.id)!;
            return (
              <li key={member.id}>
                <Link
                  href={`/coach/members/${member.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {member.name}
                      {member.role !== 'MEMBER' && (
                        <span className="pill ml-2 bg-white/10 text-white/50">
                          {member.role.toLowerCase()}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-sm text-white/40">{member.email}</p>
                  </div>

                  {state.suspended && state.suspendedUntil ? (
                    <span className="pill bg-bad/15 text-bad">
                      Paused until {formatDayDate(state.suspendedUntil)}
                    </span>
                  ) : state.currentWeight > 0 ? (
                    <span
                      className={`pill ${
                        state.oneMoreLateCancelSuspends
                          ? 'bg-warn/15 text-warn'
                          : 'bg-white/10 text-white/50'
                      }`}
                    >
                      {state.currentWeight}/{state.threshold} strikes
                    </span>
                  ) : (
                    <span className="text-sm text-white/30">Clear</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
