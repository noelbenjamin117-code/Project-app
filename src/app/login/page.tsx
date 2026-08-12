import { redirect } from 'next/navigation';
import { gymConfig } from '~/gym.config';
import { getSessionUser } from '@/lib/auth';
import { atLeast } from '@/lib/permissions';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(atLeast(user.role, 'COACH') ? '/coach' : '/schedule');

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
