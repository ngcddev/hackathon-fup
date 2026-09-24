import type { Metadata } from 'next';
import { LoginForm } from '@/components/login/LoginForm';

export const metadata: Metadata = {
  title: 'Iniciar sesión | Sistema de Gestión Hospitalaria Inteligente',
};

export default function LoginPage() {
  return <LoginForm />;
}
