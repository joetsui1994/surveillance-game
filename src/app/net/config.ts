import { SupabaseRoundsApi } from './supabase.ts';
import type { RoundsApi } from './types.ts';

/** The live backend if the build has Supabase settings; null means single-player only. */
export function createRoundsApi(env: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string } = import.meta.env): RoundsApi | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && key ? new SupabaseRoundsApi(url, key) : null;
}
