import { redirect } from 'next/navigation';
import { gymConfig } from '~/gym.config';
import { getSessionUser } from '@/lib/auth';
import { atLeast } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { serverConfigProblems } from '@/lib/config-check';
import { ConfigProblems } from '@/components/config-problems';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Signing in mints a signed session cookie, so a missing secret has to be
  // reported here rather than as a crash on submit.
  const problems = serverConfigProblems();
  if (problems.length > 0) return <ConfigProblems problems={problems} />;

  const user = await getSessionUser();
  if (user) redirect(atLeast(user.role, 'COACH') ? '/coach' : '/schedule');

  // A brand-new deployment has nobody to sign in as — send them to setup
  // rather than showing a form that cannot possibly work.
  if ((await prisma.user.count()) === 0) redirect('/setup');

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">
          {gymConfig.shortName}
        </p>
        <h1 className="mt-2 text-3xl font-bold">Sign in</h1>
        <p className="mt-2 text-white/50">Book classes, log your scores, chase PRs.</p>
      </div>

      <LoginForm />
    </main>
  );
}
