import { redirect } from 'next/navigation';
import { UsersView } from '@/components/views/UsersView';
import { can } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/with-auth';

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!can(user.role, 'users:manage')) redirect('/');
  return <UsersView />;
}
