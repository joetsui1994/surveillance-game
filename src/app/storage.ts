import type { Submission } from './player/flow.ts';
import { deserializeSession, serializeSession, type Session } from './session.ts';

const KEYS = {
  nickname: 'sg.nickname',
  session: 'sg.session',
  lastOutbreak: 'sg.lastOutbreak',
  playerId: 'sg.playerId',
  lastRound: 'sg.lastRound',
  submission: 'sg.submission',
};

// localStorage can throw (private mode, quota); the game must keep working without it.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const loadNickname = (): string => read(KEYS.nickname) ?? '';
export const saveNickname = (name: string): void => write(KEYS.nickname, name);
export const loadSession = (): Session | null => deserializeSession(read(KEYS.session));
export const saveSession = (s: Session | null): void => write(KEYS.session, s === null ? null : serializeSession(s));
export const loadLastOutbreak = (): string | null => read(KEYS.lastOutbreak);
export const saveLastOutbreak = (id: string): void => write(KEYS.lastOutbreak, id);

/** A random ID for this browser, so players need no account and nicknames needn't be unique. */
export function loadPlayerId(): string {
  const existing = read(KEYS.playerId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  write(KEYS.playerId, id);
  return id;
}

/** The last round this browser joined, so a player is never put into the same round twice. */
export function loadLastRound(): number | null {
  const v = Number(read(KEYS.lastRound));
  return read(KEYS.lastRound) !== null && Number.isInteger(v) ? v : null;
}
export const saveLastRound = (id: number): void => write(KEYS.lastRound, String(id));

export function loadSubmission(): Submission | null {
  try {
    const s = JSON.parse(read(KEYS.submission) ?? 'null') as Submission | null;
    return s && typeof s.state === 'string' && s.play && Array.isArray(s.play.picks) ? s : null;
  } catch {
    return null;
  }
}
export const saveSubmission = (s: Submission | null): void => write(KEYS.submission, s === null ? null : JSON.stringify(s));
