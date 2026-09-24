import { ApiError } from '@/lib/api/errors';
import { handleQuery } from '@/lib/agent/run';
import { withAuth } from '@/lib/auth/with-auth';

const MAX_QUESTION_LENGTH = 500;
const INVALID_QUESTION = `La pregunta es obligatoria y debe tener máximo ${MAX_QUESTION_LENGTH} caracteres.`;

export const POST = withAuth('agent:query', async (request, { user }) => {
  const body: unknown = await request.json().catch(() => null);
  const raw = typeof body === 'object' && body !== null ? (body as { question?: unknown }).question : undefined;
  if (typeof raw !== 'string') throw new ApiError('VALIDATION_ERROR', INVALID_QUESTION);
  const question = raw.trim();
  if (question.length === 0 || question.length > MAX_QUESTION_LENGTH) {
    throw new ApiError('VALIDATION_ERROR', INVALID_QUESTION);
  }
  return Response.json(await handleQuery(question, user));
});
