import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { SubmitError, type PresenceHandle, type RoundsApi, type SubmitErrorKind } from '../net/types.ts';
import type { Session } from '../session.ts';
import { afterSubmit, presenceStatus, retryDelay, type Submission } from './flow.ts';

/** Send a pending submission, retrying network failures with backoff. Returns the current failure streak. */
export function useSubmitter(api: RoundsApi | null, submission: Submission | null, setSubmission: Dispatch<SetStateAction<Submission | null>>): number {
  // The streak belongs to one round's submission: a new one starts again from zero.
  const roundId = submission?.play.roundId ?? null;
  const [streak, setStreak] = useState<{ roundId: number | null; failures: number }>({ roundId: null, failures: 0 });
  const failures = streak.roundId === roundId ? streak.failures : 0;
  useEffect(() => {
    if (!api || !submission || submission.state !== 'pending') return;
    const id = submission.play.roundId;
    let cancelled = false;
    const timer = setTimeout(async () => {
      let error: SubmitErrorKind | null = null;
      try {
        await api.submitPlay(submission.play);
      } catch (e) {
        error = e instanceof SubmitError ? e.kind : 'network';
      }
      if (cancelled) return;
      if (error === 'network') {
        setStreak((s) => ({ roundId: id, failures: (s.roundId === id ? s.failures : 0) + 1 }));
        return;
      }
      setStreak({ roundId: id, failures: 0 });
      setSubmission((s) => (s && s.state === 'pending' && s.play.roundId === id ? afterSubmit(s, error) : s));
    }, failures === 0 ? 0 : retryDelay(failures));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, submission, failures, setSubmission]);
  return failures;
}

/** Announce this player (nickname and game status) to the board while the page is open. */
export function usePresence(api: RoundsApi | null, playerId: string, nickname: string, session: Session | null): void {
  const handle = useRef<PresenceHandle | null>(null);
  const name = nickname.trim();
  const { status, roundId } = presenceStatus(session);
  useEffect(() => {
    if (!api || name === '') return;
    const h = api.joinPresence({ playerId, nickname: name, status, roundId });
    handle.current = h;
    return () => {
      h.leave();
      handle.current = null;
    };
    // Status changes are sent as updates below, without leaving and re-joining.
  }, [api, playerId, name]);
  useEffect(() => {
    handle.current?.update({ playerId, nickname: name, status, roundId });
  }, [playerId, name, status, roundId]);
}
