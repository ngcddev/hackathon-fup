import { redirect } from 'next/navigation';
import { UsuariosView } from '@/components/views/UsuariosView';
import { can } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/with-auth';

export default async function UsuariosPage() {
  const user = await getCurrentUser();
  if (!can(user.role, 'users:manage')) redirect('/');
  return <UsuariosView />;
}
