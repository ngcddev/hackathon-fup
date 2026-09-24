import 'server-only';
import { queryAsAppBackend } from '@/lib/db';
import type { LlmProvider, QueryLogStatus, QueryOrigin } from '@/lib/types/api';

export interface QueryLogRecord {
  userId: string;
  question: string; // ya sin números de documento (redactQuestionForLog)
  generatedSql: string | null;
  origin: QueryOrigin;
  llmProvider: LlmProvider | null;
  status: QueryLogStatus;
  errorMessage: string | null;
  rowCount: number | null;
  durationMs: number;
}

// SEG-06: una fila por pregunta en audit.query_log, sin las filas devueltas.
// Si el registro falla, la respuesta al usuario sale igual: el error solo va al log del servidor.
export async function logQuery(record: QueryLogRecord): Promise<void> {
  try {
    await queryAsAppBackend(
      `INSERT INTO audit.query_log
         (user_id, question, generated_sql, origin, llm_provider, status, error_message, row_count, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        record.userId,
        record.question,
        record.generatedSql,
        record.origin,
        record.llmProvider,
        record.status,
        record.errorMessage,
        record.rowCount,
        record.durationMs,
      ],
    );
  } catch (error) {
    console.error('[agent] No se pudo registrar en audit.query_log:', error);
  }
}
