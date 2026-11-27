import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { atomicWriteJsonSync } from './filePersistence.ts';

interface ClaimedAdminStore {
  salt: string;
  hash: string;
  claimedAtUtc: string;
}

export interface AdminAuthStatus {
  authRequired: boolean;
  configuredSource: 'env' | 'claimed' | 'unclaimed';
  needsSetup: boolean;
  authenticated: boolean;
}

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_SIGNING_KEY = crypto.randomBytes(32);

function defaultClaimStorePath(): string {
  return path.join(process.cwd(), 'data', 'research', '.admin_auth.json');
}

function getSigningKey(): Buffer {
  const envKey = process.env.SESSION_SECRET?.trim();
  if (envKey) {
    return crypto.createHash('sha256').update(envKey).digest();
  }
  return FALLBACK_SIGNING_KEY;
}

function sha256Buffer(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function hashPasscodeScrypt(passcode: string, saltHex?: string): { salt: string; hash: string } {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode, salt, 64).toString('hex');
  return { salt, hash: derived };
}

function verifyPasscodeScrypt(passcode: string, store: ClaimedAdminStore): boolean {
  if (!store.salt || !store.hash) return false;
  const derivedBuf = crypto.scryptSync(passcode, store.salt, 64);
  const storedBuf = Buffer.from(store.hash, 'hex');
  if (derivedBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, storedBuf);
}

function readClaimedStore(storePath: string): ClaimedAdminStore | null {
  if (!fs.existsSync(storePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as Partial<ClaimedAdminStore>;
    if (
      raw &&
      typeof raw.salt === 'string' &&
      raw.salt.length >= 16 &&
      typeof raw.hash === 'string' &&
      raw.hash.length >= 64
    ) {
      return {
        salt: raw.salt,
        hash: raw.hash,
        claimedAtUtc: typeof raw.claimedAtUtc === 'string' ? raw.claimedAtUtc : '',
      };
    }
  } catch {
    // ignore malformed store
  }
  return null;
}

export function createAdminAuthManager(options?: {
  storePath?: string;
  getEnvPasscode?: () => string | undefined;
}) {
  const storePath = options?.storePath ?? defaultClaimStorePath();
  const getEnvPasscode =
    options?.getEnvPasscode ?? (() => process.env.ADMIN_PASSCODE);
  const revokedTokens = new Set<string>();

  function getConfiguredSource(): 'env' | 'claimed' | 'unclaimed' {
    const envPass = (getEnvPasscode() ?? '').trim();
    if (envPass.length > 0) return 'env';
    if (readClaimedStore(storePath)) return 'claimed';
    return 'unclaimed';
  }

  function signToken(): string {
    const now = Date.now();
    const payloadObj = {
      role: 'admin',
      jti: crypto.randomBytes(12).toString('hex'),
      iat: now,
      exp: now + TOKEN_TTL_MS,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
    const sigB64 = crypto
      .createHmac('sha256', getSigningKey())
      .update(payloadB64)
      .digest('base64url');
    return `${payloadB64}.${sigB64}`;
  }

  function verifyToken(token: string | null | undefined): boolean {
    if (!token || typeof token !== 'string') return false;
    if (revokedTokens.has(token)) return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false;
    const payloadB64 = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    if (!payloadB64 || !sigB64) return false;

    const expectedSigB64 = crypto
      .createHmac('sha256', getSigningKey())
      .update(payloadB64)
      .digest('base64url');

    const sigBuf = Buffer.from(sigB64, 'utf8');
    const expectedBuf = Buffer.from(expectedSigB64, 'utf8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return false;
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8')
      ) as { role?: string; exp?: number };
      if (parsed.role !== 'admin') return false;
      if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return false;
      return true;
    } catch {
      return false;
    }
  }

  function extractBearerToken(req: Pick<Request, 'headers'>): string | null {
    const raw = req.headers.authorization;
    if (!raw || typeof raw !== 'string') return null;
    const m = raw.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : null;
  }

  function getStatus(req?: Pick<Request, 'headers'>): AdminAuthStatus {
    const source = getConfiguredSource();
    const token = req ? extractBearerToken(req) : null;
    return {
      authRequired: true,
      configuredSource: source,
      needsSetup: source === 'unclaimed',
      authenticated: verifyToken(token),
    };
  }

  function claimFirstPasscode(passcode: string): {
    ok: boolean;
    statusCode: number;
    token?: string;
    error?: string;
  } {
    const source = getConfiguredSource();
    if (source !== 'unclaimed') {
      return {
        ok: false,
        statusCode: 409,
        error: 'Admin passcode is already configured. Please sign in instead.',
      };
    }

    const trimmed = typeof passcode === 'string' ? passcode.trim() : '';
    if (trimmed.length < 6 || trimmed.length > 128) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Choose an admin passcode between 6 and 128 characters.',
      };
    }

    const { salt, hash } = hashPasscodeScrypt(trimmed);
    const payload: ClaimedAdminStore = {
      salt,
      hash,
      claimedAtUtc: new Date().toISOString(),
    };
    atomicWriteJsonSync(storePath, payload, { pretty: true, preserveBackup: false });
    return {
      ok: true,
      statusCode: 201,
      token: signToken(),
    };
  }

  function loginWithPasscode(passcode: string): {
    ok: boolean;
    statusCode: number;
    token?: string;
    error?: string;
  } {
    const source = getConfiguredSource();
    if (source === 'unclaimed') {
      return {
        ok: false,
        statusCode: 428,
        error: 'Admin passcode is not configured yet. Complete one-time setup first.',
      };
    }

    const candidate = typeof passcode === 'string' ? passcode.trim() : '';
    if (!candidate) {
      return {
        ok: false,
        statusCode: 401,
        error: 'Admin passcode is required.',
      };
    }

    if (source === 'env') {
      const envPass = (getEnvPasscode() ?? '').trim();
      const valid = crypto.timingSafeEqual(sha256Buffer(candidate), sha256Buffer(envPass));
      if (!valid) {
        return { ok: false, statusCode: 401, error: 'Invalid admin passcode.' };
      }
      return { ok: true, statusCode: 200, token: signToken() };
    }

    const store = readClaimedStore(storePath);
    if (!store || !verifyPasscodeScrypt(candidate, store)) {
      return { ok: false, statusCode: 401, error: 'Invalid admin passcode.' };
    }
    return { ok: true, statusCode: 200, token: signToken() };
  }

  function revokeToken(req: Pick<Request, 'headers'>): void {
    const token = extractBearerToken(req);
    if (token) {
      revokedTokens.add(token);
      if (revokedTokens.size > 500) {
        const first = revokedTokens.values().next().value;
        if (first) revokedTokens.delete(first);
      }
    }
  }

  function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
    const token = extractBearerToken(req);
    if (verifyToken(token)) {
      next();
      return;
    }
    const source = getConfiguredSource();
    res.status(401).json({
      error:
        source === 'unclaimed'
          ? 'Admin setup required before modifying workspace state.'
          : 'Authentication required. Sign in with your admin passcode.',
      code: source === 'unclaimed' ? 'ADMIN_SETUP_REQUIRED' : 'AUTH_REQUIRED',
      needsSetup: source === 'unclaimed',
    });
  }

  return {
    getStatus,
    claimFirstPasscode,
    loginWithPasscode,
    revokeToken,
    verifyToken,
    requireAdminAuth,
  };
}

export const adminAuth = createAdminAuthManager();
