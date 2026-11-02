// Shared setup for scripts that talk to the real Supabase project (smoke test, load test).
import { FakeRoundsApi } from '../src/app/net/fake.ts';
import { SupabaseRoundsApi } from '../src/app/net/supabase.ts';
import { openRound, type Round, type RoundsApi } from '../src/app/net/types.ts';
import { loadPresets } from './io.ts';

export function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. Put VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local and run with PRESENTER_PIN=… in the environment.`);
    process.exit(2);
  }
  return v;
}

// LIVE_FAKE=1 runs the script against one shared in-memory backend (PIN 1234), to check the script itself.
const fake = process.env.LIVE_FAKE ? new FakeRoundsApi('1234') : null;

export const newApi = (): RoundsApi => fake ?? new SupabaseRoundsApi(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'));

/** Resolve when `check` passes on a value pushed by `subscribe`, or reject after `ms`. */
export function waitFor<T>(subscribe: (cb: (v: T) => void) => () => void, check: (v: T) => boolean, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    let unsub: (() => void) | null = null;
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      unsub?.();
      reject(new Error(`timed out after ${ms} ms`));
    }, ms);
    unsub = subscribe((v) => {
      if (done || !check(v)) return;
      done = true;
      clearTimeout(timer);
      queueMicrotask(() => unsub?.());
      resolve(v);
    });
  });
}

/**
 * Refuse to run while a real round is open, unless --force (then close it: a round can't be opened over an open one).
 * Returns the rounds so far.
 */
export async function guardOpenRound(api: RoundsApi, pin: string): Promise<Round[]> {
  const rounds = await waitFor<Round[]>((cb) => api.onRounds(cb), () => true);
  const open = openRound(rounds);
  if (open && !process.argv.includes('--force')) {
    console.error(`Round ${open.number} is open. These scripts would close it. Re-run with --force if that's OK.`);
    process.exit(2);
  }
  if (open) await api.closeRound(pin, open.id);
  return rounds;
}

/** The first round outbreak of the first preset, and nodes other than its seed. */
export function testOutbreak() {
  const preset = loadPresets().presets[0];
  const outbreak = preset.outbreaks.find((o) => o.split === 'round')!;
  const nodes = Array.from({ length: preset.n }, (_, j) => j).filter((j) => j !== outbreak.seedNode);
  return { preset, outbreak, nodes };
}

let failures = 0;
export async function check(label: string, f: () => Promise<unknown>): Promise<void> {
  try {
    await f();
    console.log(`  PASS  ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
export const failed = (): number => failures;

export function expectEqual<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
}
