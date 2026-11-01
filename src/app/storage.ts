import { deserializeSession, serializeSession, type Session } from './session.ts';

const KEYS = { nickname: 'sg.nickname', session: 'sg.session', lastOutbreak: 'sg.lastOutbreak' };

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
