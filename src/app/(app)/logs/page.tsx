import { redirect } from 'next/navigation';
import { LogsView } from '@/components/views/LogsView';
import { can } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/with-auth';

export default async function LogsPage() {
  const user = await getCurrentUser();
  if (!can(user.role, 'logs:view')) redirect('/');
  return <LogsView />;
}
