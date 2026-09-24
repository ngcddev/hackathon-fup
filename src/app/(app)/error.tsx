'use client';

import { ErrorState } from '@/components/ui/States';

// Falla inesperada al armar la pantalla (por ejemplo, la base no responde). No se muestra detalle técnico.
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-[720px] px-5 py-16">
      <ErrorState label="la pantalla" onRetry={reset} />
    </div>
  );
}
