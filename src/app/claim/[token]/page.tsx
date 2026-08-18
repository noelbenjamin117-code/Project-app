import Link from 'next/link';
import { gymConfig } from '~/gym.config';
import { peekClaim } from '@/lib/services/migration';
import { AppError } from '@/lib/errors';
import { ClaimForm } from './claim-form';

export const dynamic = 'force-dynamic';

/**
 * Where a migrating member lands. One link, one password, then payment —
 * no profile form, no waiver, nothing that can be collected later.
 */
export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let target;
  try {
    target = await peekClaim(token);
  } catch (error) {
    const message =
      error instanceof AppError ? error.message : 'That link isn’t valid.';

    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">
          {gymConfig.shortName}
        </p>
        <h1 className="mt-2 text-2xl font-bold">This link won’t work</h1>
        <p className="mt-2 text-white/60">{message}</p>
        <Link href="/login" className="btn-primary mt-6">
          Go to sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">
          {gymConfig.shortName}
        </p>
        <h1 className="mt-2 text-3xl font-bold">Welcome back, {target.name.split(' ')[0]}</h1>
        <p className="mt-2 text-white/60">
          Your account is ready. Pick a password and you’re in — takes about twenty seconds.
        </p>
      </div>

      <div className="card mb-5 p-4 text-sm">
        <p className="text-white/50">Signing in as</p>
        <p className="mt-0.5 font-semibold">{target.email}</p>
        <p className="mt-2 text-xs text-white/40">
          Not you? Speak to us at the gym rather than carrying on.
        </p>
      </div>

      <ClaimForm token={token} />
    </main>
  );
}
