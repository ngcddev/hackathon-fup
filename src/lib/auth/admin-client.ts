import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cliente de Supabase Auth con la service role key. Solo servidor (regla 4): la variable no lleva NEXT_PUBLIC_.
let cached: SupabaseClient | undefined;

export function getAuthAdmin(): SupabaseClient {
  if (!cached) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
    cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return cached;
}
