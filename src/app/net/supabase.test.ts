import { describe, expect, it } from 'vitest';
import { submitErrorKind } from './supabase.ts';

describe('submitErrorKind', () => {
  it('maps database exceptions, server faults and lost connections', () => {
    expect(submitErrorKind({ status: 400, error: { message: 'duplicate', code: 'P0001' } })).toBe('duplicate');
    expect(submitErrorKind({ status: 400, error: { message: 'round_closed', code: 'P0001' } })).toBe('round_closed');
    expect(submitErrorKind({ status: 400, error: { message: 'invalid', code: 'P0001' } })).toBe('invalid');
    expect(submitErrorKind({ status: 404, error: { message: 'Could not find the function', code: 'PGRST202' } })).toBe('invalid');
    expect(submitErrorKind({ status: 503, error: { message: 'upstream', code: '' } })).toBe('network');
    expect(submitErrorKind({ status: 0, error: { message: 'TypeError: fetch failed', code: '' } })).toBe('network');
    // What postgrest-js returns when the 8 s abortSignal timeout fires.
    expect(submitErrorKind({ status: 0, error: { message: 'TimeoutError: The operation was aborted due to timeout', code: '' } })).toBe('network');
  });
});
