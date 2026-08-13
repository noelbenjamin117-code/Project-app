import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { atLeast } from '@/lib/permissions';

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  redirect(atLeast(user.role, 'COACH') ? '/coach' : '/schedule');
}
