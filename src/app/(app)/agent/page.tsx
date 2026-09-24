import { AgentChatView } from '@/components/views/AgentChatView';

// Desde el resumen o el encabezado se llega con `q` (pregunta), `send=1` (enviarla al abrir) y `n` (identifica la solicitud).
export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <AgentChatView
      initialQuestion={first(params.q) ?? ''}
      autoSend={first(params.send) === '1'}
      requestId={first(params.n) ?? ''}
    />
  );
}
