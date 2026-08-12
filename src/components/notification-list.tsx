'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/app/actions/notifications';

export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  agoLabel: string;
}

const TONE: Record<string, string> = {
  WAITLIST_PROMOTED: 'border-ok/40 bg-ok/10',
  CLASS_CANCELLED: 'border-bad/40 bg-bad/10',
  STRIKE_RECORDED: 'border-warn/40 bg-warn/10',
  SUSPENDED: 'border-bad/40 bg-bad/10',
  SUSPENSION_LIFTED: 'border-ok/40 bg-ok/10',
};

/**
 * In-app is the only delivery channel in v1, so an unread promotion has to be
 * impossible to miss — this sits at the top of the screen members open most.
 */
export function NotificationList({ notifications }: { notifications: NotificationView[] }) {
  const [pending, startTransition] = useTransition();

  if (notifications.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-white/40">Updates</h3>
        {notifications.length > 1 && (
          <button
            className="text-xs text-white/40 underline"
            disabled={pending}
            onClick={() => startTransition(() => markAllNotificationsReadAction())}
          >
            Clear all
          </button>
        )}
      </div>

      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`rounded-xl border px-4 py-3 ${TONE[notification.kind] ?? 'border-edge bg-panel'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{notification.title}</p>
              <p className="mt-0.5 text-sm text-white/70">{notification.body}</p>
              <p className="mt-1 text-xs text-white/30">{notification.agoLabel}</p>
            </div>
            <button
              className="shrink-0 text-xs text-white/40 underline"
              disabled={pending}
              onClick={() =>
                startTransition(() => markNotificationReadAction(notification.id))
              }
            >
              Got it
            </button>
          </div>

          {notification.href && (
            <Link
              href={notification.href}
              className="mt-2 inline-block text-sm font-semibold text-brand underline"
            >
              View
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}
