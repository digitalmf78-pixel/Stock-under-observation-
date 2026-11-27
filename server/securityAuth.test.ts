import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import { createAdminAuthManager } from './adminAuth.ts';

function createMockRes() {
  const resState = {
    statusCode: 200,
    body: null as unknown,
  };
  const res = {
    status(code: number) {
      resState.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      resState.body = payload;
      return this;
    },
  } as unknown as Response;
  return { res, resState };
}

describe('Admin Auth, Cookie Containment & API Security Controls', () => {
  it('supports one-time scrypt setup claim, rejects duplicate setup (409), and validates logins', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-auth-test-'));
    const storePath = path.join(tmpDir, '.admin_auth.json');

    try {
      const auth = createAdminAuthManager({
        storePath,
        getEnvPasscode: () => '',
      });

      assert.equal(auth.getStatus().needsSetup, true);
      assert.equal(auth.getStatus().configuredSource, 'unclaimed');

      const shortAttempt = auth.claimFirstPasscode('123');
      assert.equal(shortAttempt.ok, false);
      assert.equal(shortAttempt.statusCode, 400);

      const claimed = auth.claimFirstPasscode('MySecretPass#2026');
      assert.equal(claimed.ok, true);
      assert.equal(claimed.statusCode, 201);
      assert.ok(claimed.token);

      // Claimed store file must only contain salted scrypt hash (never plaintext passcode)
      const persisted = fs.readFileSync(storePath, 'utf-8');
      assert.equal(persisted.includes('MySecretPass#2026'), false);

      // Re-claiming must fail with 409 Conflict
      const duplicateClaim = auth.claimFirstPasscode('AnotherPass#2026');
      assert.equal(duplicateClaim.ok, false);
      assert.equal(duplicateClaim.statusCode, 409);

      const wrongLogin = auth.loginWithPasscode('WrongPass');
      assert.equal(wrongLogin.ok, false);
      assert.equal(wrongLogin.statusCode, 401);

      const validLogin = auth.loginWithPasscode('MySecretPass#2026');
      assert.equal(validLogin.ok, true);
      assert.ok(validLogin.token);
      assert.equal(auth.verifyToken(validLogin.token), true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('honors ADMIN_PASSCODE env override, enforces requireAdminAuth middleware, and revokes tokens on logout', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-auth-env-'));
    const storePath = path.join(tmpDir, '.admin_auth.json');

    try {
      const auth = createAdminAuthManager({
        storePath,
        getEnvPasscode: () => 'EnvOverrideSecret!99',
      });

      assert.equal(auth.getStatus().configuredSource, 'env');
      assert.equal(auth.getStatus().needsSetup, false);
      assert.equal(auth.loginWithPasscode('bad').statusCode, 401);

      const login = auth.loginWithPasscode('EnvOverrideSecret!99');
      assert.equal(login.ok, true);
      assert.ok(login.token);

      // Unauthenticated request blocked with 401
      let nextCalled = false;
      const unauth = createMockRes();
      auth.requireAdminAuth({ headers: {} } as Request, unauth.res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, false);
      assert.equal(unauth.resState.statusCode, 401);

      // Valid Bearer token allowed
      const authedReq = { headers: { authorization: `Bearer ${login.token}` } } as Request;
      const okRes = createMockRes();
      auth.requireAdminAuth(authedReq, okRes.res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true);

      // Revoked token rejected immediately
      auth.revokeToken(authedReq);
      nextCalled = false;
      const afterLogout = createMockRes();
      auth.requireAdminAuth(authedReq, afterLogout.res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, false);
      assert.equal(afterLogout.resState.statusCode, 401);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('ensures no NSE runtime cookie file exists under data/ and catalystFetcher keeps cookies out of workspace data/', () => {
    const dataDir = path.join(process.cwd(), 'data');
    if (fs.existsSync(dataDir)) {
      const cookieFiles = fs
        .readdirSync(dataDir)
        .filter((f) => /cookies.*\.json$/i.test(f));
      assert.deepEqual(
        cookieFiles,
        [],
        `Found exposed cookie file(s) inside workspace data/: ${cookieFiles.join(', ')}`
      );
    }

    const catalystFetcherSrc = fs.readFileSync(
      path.join(process.cwd(), 'server', 'catalystFetcher.ts'),
      'utf-8'
    );
    assert.equal(catalystFetcherSrc.includes("os.tmpdir(), 'nse-bse-api-cache'"), true);
    assert.equal(catalystFetcherSrc.includes("cookieDir: path.join(process.cwd(), 'data')"), false);
  });
});
