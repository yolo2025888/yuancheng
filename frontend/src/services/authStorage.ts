import type { StoredAuthSession } from '../types/models';

const LOCAL_STORAGE_KEY = 'employee-monitor-admin.auth.local';
const SESSION_STORAGE_KEY = 'employee-monitor-admin.auth.session';

export function getStoredAuthSession() {
  if (!isBrowser()) {
    return null;
  }

  return readStoredSession(window.sessionStorage, SESSION_STORAGE_KEY);
}

export function getStoredAccessToken() {
  return getStoredAuthSession()?.token ?? null;
}

export function saveStoredAuthSession(session: StoredAuthSession) {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  window.sessionStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({ ...session, storageMode: 'session' })
  );
}

export function clearStoredAuthSession() {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function readStoredSession(storage: Storage, key: string) {
  const rawValue = storage.getItem(key);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as StoredAuthSession;
    if (!parsed?.token || !parsed?.user?.username) {
      storage.removeItem(key);
      return null;
    }

    return parsed;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

function isBrowser() {
  return typeof window !== 'undefined';
}
