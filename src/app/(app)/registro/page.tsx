import { redirect } from 'next/navigation';
import { RegistroView } from '@/components/views/RegistroView';
import { can } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/with-auth';

export default async function RegistroPage() {
  const user = await getCurrentUser();
  if (!can(user.role, 'logs:view')) redirect('/');
  return <RegistroView />;
}
