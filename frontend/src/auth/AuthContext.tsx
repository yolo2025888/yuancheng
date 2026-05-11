import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { adminApi } from '../services/adminApi';
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  saveStoredAuthSession
} from '../services/authStorage';
import type {
  ApiStatus,
  AuthIdentity,
  AuthSessionSeed,
  AuthStorageMode,
  StoredAuthSession
} from '../types/models';

type AuthStatus = 'booting' | 'authenticated' | 'unauthenticated';

type LoginResult = {
  ok: boolean;
  apiStatus: ApiStatus;
  unauthorized?: boolean;
  devFallbackAvailable: boolean;
};

type AuthContextValue = {
  status: AuthStatus;
  session: StoredAuthSession | null;
  apiStatus: ApiStatus | null;
  permissionsResolved: boolean;
  signIn: (
    identifier: string,
    password: string,
    storageMode: AuthStorageMode
  ) => Promise<LoginResult>;
  useLocalDevSession: (identifier: string, storageMode: AuthStorageMode) => void;
  logout: () => void;
  canAccess: (...permissionKeys: string[]) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);

  const commitSession = useCallback(
    (seed: AuthSessionSeed, storageMode: AuthStorageMode) => {
      const nextSession: StoredAuthSession = {
        ...seed,
        storageMode
      };

      saveStoredAuthSession(nextSession);
      setSession(nextSession);
      setStatus('authenticated');
      return nextSession;
    },
    []
  );

  const logout = useCallback(() => {
    clearStoredAuthSession();
    setSession(null);
    setApiStatus(null);
    setStatus('unauthenticated');
  }, []);

  const refreshStoredSession = useCallback(
    async (storedSession: StoredAuthSession) => {
      setSession(storedSession);
      const meResult = await adminApi.getCurrentUser();
      setApiStatus(meResult.apiStatus);

      if (meResult.data) {
        commitSession(
          {
            token: storedSession.token,
            user: mergeIdentity(storedSession.user, meResult.data),
            source: 'live'
          },
          storedSession.storageMode
        );
        return;
      }

      if (meResult.unauthorized) {
        logout();
        return;
      }

      if (import.meta.env.DEV) {
        commitSession(
          {
            token: storedSession.token,
            user: storedSession.user,
            source: 'local-dev'
          },
          storedSession.storageMode
        );
        return;
      }

      logout();
    },
    [commitSession, logout]
  );

  useEffect(() => {
    const storedSession = getStoredAuthSession();

    if (!storedSession) {
      setStatus('unauthenticated');
      return;
    }

    void refreshStoredSession(storedSession);
  }, [refreshStoredSession]);

  const signIn = useCallback(
    async (identifier: string, password: string, storageMode: AuthStorageMode) => {
      const loginResult = await adminApi.login(identifier, password);
      setApiStatus(loginResult.apiStatus);

      if (!loginResult.data) {
        setStatus('unauthenticated');
        return {
          ok: false,
          apiStatus: loginResult.apiStatus,
          unauthorized: loginResult.unauthorized,
          devFallbackAvailable: import.meta.env.DEV && !loginResult.unauthorized
        };
      }

      const committedSession = commitSession(loginResult.data, storageMode);
      const meResult = await adminApi.getCurrentUser();

      if (meResult.data) {
        commitSession(
          {
            token: committedSession.token,
            user: mergeIdentity(committedSession.user, meResult.data),
            source: 'live'
          },
          storageMode
        );
        setApiStatus(meResult.apiStatus);

        return {
          ok: true,
          apiStatus: meResult.apiStatus,
          devFallbackAvailable: false
        };
      }

      setApiStatus(meResult.apiStatus);

      if (meResult.unauthorized) {
        logout();
        return {
          ok: false,
          apiStatus: meResult.apiStatus,
          unauthorized: true,
          devFallbackAvailable: false
        };
      }

      if (import.meta.env.DEV) {
        commitSession(
          {
            token: committedSession.token,
            user: committedSession.user,
            source: 'local-dev'
          },
          storageMode
        );
      }

      return {
        ok: true,
        apiStatus: meResult.apiStatus,
        devFallbackAvailable: import.meta.env.DEV
      };
    },
    [commitSession, logout]
  );

  const useLocalDevSession = useCallback(
    (identifier: string, storageMode: AuthStorageMode) => {
      const normalizedIdentifier = identifier.trim() || 'local.dev.admin';

      commitSession(
        {
          token: `local-dev-${Date.now()}`,
          user: {
            username: normalizedIdentifier,
            displayName: normalizedIdentifier,
            roleName: 'Local Dev Fallback',
            permissionKeys: [],
            permissionsResolved: false
          },
          source: 'local-dev'
        },
        storageMode
      );
      setApiStatus({
        source: 'mock',
        state: 'fallback',
        label: 'Local dev fallback',
        detail:
          'Auth endpoints are unavailable in local development. This session is a frontend-only fallback and must not be treated as a production bypass.',
        endpoint: '/api/auth/login'
      });
    },
    [commitSession]
  );

  const permissionsResolved = session?.user.permissionsResolved ?? false;

  const canAccess = useCallback(
    (...permissionKeys: string[]) => {
      if (permissionKeys.length === 0 || !permissionsResolved) {
        return true;
      }

      const grantedKeys = new Set(session?.user.permissionKeys ?? []);
      return permissionKeys.some((permissionKey) => grantedKeys.has(permissionKey.toLowerCase()));
    },
    [permissionsResolved, session?.user.permissionKeys]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      apiStatus,
      permissionsResolved,
      signIn,
      useLocalDevSession,
      logout,
      canAccess
    }),
    [apiStatus, canAccess, logout, permissionsResolved, session, signIn, status, useLocalDevSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

function mergeIdentity(currentUser: AuthIdentity, nextUser: AuthIdentity): AuthIdentity {
  return {
    ...currentUser,
    ...nextUser,
    displayName: nextUser.displayName || currentUser.displayName,
    permissionKeys:
      nextUser.permissionKeys.length > 0 || nextUser.permissionsResolved
        ? nextUser.permissionKeys
        : currentUser.permissionKeys,
    permissionsResolved: nextUser.permissionsResolved || currentUser.permissionsResolved
  };
}
