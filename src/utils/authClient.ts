export interface ClientAuthState {
  needsSetup: boolean;
  configuredSource: 'env' | 'claimed' | 'unclaimed';
  authenticated: boolean;
  modalOpen: boolean;
}

// Strictly in-memory session token (never stored in localStorage or sessionStorage)
let adminToken: string | null = null;

let authState: ClientAuthState = {
  needsSetup: false,
  configuredSource: 'unclaimed',
  authenticated: false,
  modalOpen: false,
};

type AuthListener = (state: ClientAuthState) => void;
const listeners = new Set<AuthListener>();
let pendingUnlockWaiters: Array<(unlocked: boolean) => void> = [];

function emitAuthState(): void {
  const snapshot: ClientAuthState = { ...authState };
  for (const fn of listeners) {
    fn(snapshot);
  }
}

export function subscribeAuthState(listener: AuthListener): () => void {
  listeners.add(listener);
  listener({ ...authState });
  return () => {
    listeners.delete(listener);
  };
}

export function getAuthStateSnapshot(): ClientAuthState {
  return { ...authState };
}

export function hasAdminToken(): boolean {
  return Boolean(adminToken);
}

export function getAuthHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (adminToken) {
    headers.set('Authorization', `Bearer ${adminToken}`);
  }
  return headers;
}

export async function refreshAuthStatus(): Promise<ClientAuthState> {
  try {
    const res = await fetch('/api/auth/status', {
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        needsSetup?: boolean;
        configuredSource?: 'env' | 'claimed' | 'unclaimed';
        authenticated?: boolean;
      };
      if (json.authenticated === false && adminToken) {
        adminToken = null;
      }
      authState = {
        ...authState,
        needsSetup: Boolean(json.needsSetup),
        configuredSource: json.configuredSource ?? authState.configuredSource,
        authenticated: Boolean(json.authenticated),
      };
      emitAuthState();
    }
  } catch {
    // ignore transient network errors
  }
  return { ...authState };
}

function resolveUnlockWaiters(unlocked: boolean): void {
  const waiters = pendingUnlockWaiters;
  pendingUnlockWaiters = [];
  for (const resolve of waiters) {
    resolve(unlocked);
  }
}

export function openAuthModal(): void {
  void refreshAuthStatus();
  authState = { ...authState, modalOpen: true };
  emitAuthState();
}

export function closeAuthModal(): void {
  if (!authState.modalOpen && pendingUnlockWaiters.length === 0) return;
  authState = { ...authState, modalOpen: false };
  emitAuthState();
  resolveUnlockWaiters(false);
}

export function requestAdminUnlock(needsSetupHint?: boolean): Promise<boolean> {
  if (adminToken) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    pendingUnlockWaiters.push(resolve);
    authState = {
      ...authState,
      needsSetup: needsSetupHint ?? authState.needsSetup,
      modalOpen: true,
    };
    emitAuthState();
    void refreshAuthStatus();
  });
}

export async function setupAdminPasscode(passcode: string): Promise<ClientAuthState> {
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  const json = (await res.json()) as {
    token?: string;
    needsSetup?: boolean;
    configuredSource?: 'env' | 'claimed' | 'unclaimed';
    authenticated?: boolean;
    error?: string;
  };
  if (!res.ok || !json.token) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  adminToken = json.token;
  authState = {
    needsSetup: Boolean(json.needsSetup),
    configuredSource: json.configuredSource ?? 'claimed',
    authenticated: true,
    modalOpen: false,
  };
  emitAuthState();
  resolveUnlockWaiters(true);
  return { ...authState };
}

export async function loginAdminPasscode(passcode: string): Promise<ClientAuthState> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  const json = (await res.json()) as {
    token?: string;
    needsSetup?: boolean;
    configuredSource?: 'env' | 'claimed' | 'unclaimed';
    authenticated?: boolean;
    error?: string;
  };
  if (!res.ok || !json.token) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  adminToken = json.token;
  authState = {
    needsSetup: Boolean(json.needsSetup),
    configuredSource: json.configuredSource ?? 'claimed',
    authenticated: true,
    modalOpen: false,
  };
  emitAuthState();
  resolveUnlockWaiters(true);
  return { ...authState };
}

export async function logoutAdmin(): Promise<void> {
  try {
    if (adminToken) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    }
  } catch {
    // ignore network failure on logout
  } finally {
    adminToken = null;
    authState = {
      ...authState,
      authenticated: false,
    };
    emitAuthState();
    void refreshAuthStatus();
  }
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    headers: getAuthHeaders(init.headers),
  });

  if (res.status !== 401) {
    return res;
  }

  let needsSetupHint: boolean | undefined;
  try {
    const cloned = res.clone();
    const errBody = (await cloned.json()) as { needsSetup?: boolean };
    if (typeof errBody?.needsSetup === 'boolean') {
      needsSetupHint = errBody.needsSetup;
    }
  } catch {
    // ignore parse failures
  }

  adminToken = null;
  authState = {
    ...authState,
    authenticated: false,
    needsSetup: needsSetupHint ?? authState.needsSetup,
  };
  emitAuthState();

  const unlocked = await requestAdminUnlock(needsSetupHint);
  if (!unlocked) {
    return res;
  }

  return fetch(input, {
    ...init,
    headers: getAuthHeaders(init.headers),
  });
}
