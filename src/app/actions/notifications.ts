'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Waitlist promotions, cancellations and strikes are delivered in-app in v1,
 * so this is the only place a member finds out a spot opened up. Marking read
 * is scoped to the signed-in user — an id from the client is never trusted.
 */
export async function markNotificationReadAction(notificationId: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  await prisma.notification.updateMany({
    where: { id: notificationId, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath('/schedule');
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  revalidatePath('/schedule');
}
