import { redirect } from 'next/navigation';
import { gymConfig } from '~/gym.config';
import { prisma } from '@/lib/db';
import { serverConfigProblems } from '@/lib/config-check';
import { DEFAULT_TEMPLATE_SHAPES } from '@/lib/bootstrap';
import { ConfigProblems } from '@/components/config-problems';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

/**
 * First run. This is how the gym gets its owner account without anyone needing
 * a terminal — the whole deployment can be set up from a phone.
 *
 * It exists only while the database has no users; the moment one exists this
 * redirects to the login page, so it cannot be used to mint a second owner.
 */
export default async function SetupPage() {
  // Checked before anything is written: creating the owner and then failing to
  // sign them in would leave the gym set up and nobody able to get into it.
  const problems = serverConfigProblems();
  if (problems.length > 0) return <ConfigProblems problems={problems} />;

  const userCount = await prisma.user.count();
  if (userCount > 0) redirect('/login');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">
          {gymConfig.shortName}
        </p>
        <h1 className="mt-2 text-3xl font-bold">Set up your gym</h1>
        <p className="mt-2 text-white/50">
          This creates your owner account. It only works once — after this, the page is closed
          off and new people are added from inside the app.
        </p>
      </div>

      <SetupForm
        gymName={gymConfig.name}
        timezone={gymConfig.timezone}
        templateCount={DEFAULT_TEMPLATE_SHAPES.length}
      />
    </main>
  );
}
