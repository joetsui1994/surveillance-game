import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { SubmitError, type PresenceHandle, type RoundsApi, type SubmitErrorKind } from '../net/types.ts';
import type { Session } from '../session.ts';
import { afterSubmit, presenceStatus, retryDelay, type Submission } from './flow.ts';

/** Send a pending submission, retrying network failures with backoff. Returns the current failure streak. */
export function useSubmitter(api: RoundsApi | null, submission: Submission | null, setSubmission: Dispatch<SetStateAction<Submission | null>>): number {
  const [failures, setFailures] = useState(0);
  useEffect(() => {
    if (!api || !submission || submission.state !== 'pending') return;
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
        setFailures((f) => f + 1);
        return;
      }
      setFailures(0);
      setSubmission((s) => (s && s.state === 'pending' && s.play.roundId === submission.play.roundId ? afterSubmit(s, error) : s));
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
