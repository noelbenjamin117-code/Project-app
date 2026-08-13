'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { runSetup, type SetupFormState } from '@/app/actions/setup';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Setting up…' : 'Create my gym'}
    </button>
  );
}

export function SetupForm({
  gymName,
  timezone,
  templateCount,
}: {
  gymName: string;
  timezone: string;
  templateCount: number;
}) {
  const [state, action] = useActionState<SetupFormState, FormData>(runSetup, { error: null });

  return (
    <form action={action} className="space-y-5">
      <div className="card p-4 text-sm">
        <p className="text-white/50">These come from your config file:</p>
        <p className="mt-1">
          <span className="font-semibold">{gymName}</span>
          <span className="text-white/40"> · {timezone}</span>
        </p>
        <p className="mt-2 text-xs text-white/40">
          Wrong? Edit <code className="text-white/60">gym.config.ts</code> in the repo and
          redeploy — it takes a minute and changing the timezone later would reinterpret every
          class time already saved.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="name">
          Your name
        </label>
        <input id="name" name="name" required className="input" placeholder="Dana Reyes" />
      </div>

      <div>
        <label className="label" htmlFor="email">
          Your email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoCapitalize="none"
          required
          className="input"
          placeholder="you@yourgym.com"
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          className="input"
          placeholder="At least 8 characters"
        />
      </div>

      <div>
        <label className="label" htmlFor="confirm">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          className="input"
          placeholder="Type it again"
        />
      </div>

      <div className="space-y-3 border-t border-edge pt-5">
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="includeSchedule"
            defaultChecked
            className="mt-0.5 h-5 w-5 accent-[#f2542d]"
          />
          <span className="text-white/70">
            Create my weekly schedule
            <span className="block text-xs text-white/40">
              All {templateCount} classes: BLITZ42 Monday, ATHELERIX42 and Run Club Tuesday,
              HYROX and CALIBRATE42 Wednesday, BUILD42 Thursday, HYROX Friday and Sunday — with
              each class's cancellation rule already set. Fully editable afterwards.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="includeBenchmarks"
            defaultChecked
            className="mt-0.5 h-5 w-5 accent-[#f2542d]"
          />
          <span className="text-white/70">
            Add the benchmark WODs
            <span className="block text-xs text-white/40">
              Fran, Cindy, Grace, Helen, Diane, Isabel, Karen, Annie, Jackie and Murph, plus the
              barbell lifts for PR tracking.
            </span>
          </span>
        </label>
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}

      <SubmitButton />

      <p className="text-center text-xs text-white/30">
        No members are created — you add those from the Members page once you're in.
      </p>
    </form>
  );
}
