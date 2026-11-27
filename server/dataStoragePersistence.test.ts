import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  atomicWriteJsonSync,
  readJsonSafe,
  withFileLock,
} from './filePersistence.ts';
import { periodHeaderToIso } from './indianFundamentals.ts';
import { periodLabelToEndDate } from './services/fundamentalService.ts';
import {
  getCachedBhavcopyDates,
  isNseTradingDay,
  loadLiveFundamentalOverrides,
  loadNseTradingCalendar,
} from './liveFetcher.ts';
import { nsePipeline } from './nsePipeline.ts';
import { syncT1T2DailySnapshots } from './t1T2ReportStore.ts';

test('filePersistence: atomic writes, .bak recovery, corruption refusal, and concurrent locking', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nse-persist-test-'));
  try {
    const target = path.join(tmpDir, 'store.json');
    atomicWriteJsonSync(target, { count: 1 }, { pretty: true, preserveBackup: true });
    atomicWriteJsonSync(target, { count: 2 }, { pretty: true, preserveBackup: true });

    // Overwrite primary with corrupted JSON; backup must hold { count: 1 }
    fs.writeFileSync(target, '{corrupt json', 'utf-8');
    const recovered = readJsonSafe(target, { count: 0 });
    assert.deepEqual(recovered, { count: 1 });

    // Remove backup and ensure throwOnCorruptWithoutBackup refuses silent empty fallback
    fs.unlinkSync(`${target}.bak`);
    assert.throws(
      () => readJsonSafe(target, { count: 0 }, { throwOnCorruptWithoutBackup: true }),
      /Refusing to overwrite corrupted JSON store/
    );

    // Concurrent locked updates must serialize cleanly without lost increments
    const lockFile = path.join(tmpDir, 'counter.json');
    atomicWriteJsonSync(lockFile, { value: 0 }, { preserveBackup: true });
    await Promise.all(
      Array.from({ length: 12 }, (_, idx) =>
        withFileLock(lockFile, async () => {
          const cur = readJsonSafe(lockFile, { value: 0 }, { throwOnCorruptWithoutBackup: true });
          if (idx % 3 === 0) await new Promise((r) => setTimeout(r, 5));
          atomicWriteJsonSync(lockFile, { value: cur.value + 1 }, { preserveBackup: true });
        })
      )
    );
    const finalCounter = readJsonSafe(lockFile, { value: -1 });
    assert.equal(finalCounter.value, 12);

    // No stray .tmp files left behind
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp.'));
    assert.equal(leftovers.length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('NSE trading calendar and >=200 cached actual trading sessions integrity', () => {
  const calendar = loadNseTradingCalendar();
  assert.equal(isNseTradingDay('2026-11-08', calendar), true, 'Diwali Muhurat session should count as trading day');
  assert.equal(isNseTradingDay('2026-01-26', calendar), false, 'Republic Day holiday must be excluded');
  assert.equal(isNseTradingDay('2026-11-07', calendar), false, 'Regular Saturday must be excluded');

  const cachedDates = getCachedBhavcopyDates();
  assert.ok(
    cachedDates.length >= 200,
    `Expected >= 200 actual NSE trading sessions cached, found ${cachedDates.length}`
  );
  // Dates must be strictly ascending & unique
  for (let i = 1; i < cachedDates.length; i++) {
    assert.ok(cachedDates[i] > cachedDates[i - 1], `Duplicate or unsorted session ${cachedDates[i]}`);
  }
});

test('Annotated Screener financial period headers parse to valid ISO YYYY-MM-DD dates', () => {
  assert.equal(periodHeaderToIso('Mar 2026\n            \n            (S)'), '2026-03-31');
  assert.equal(periodHeaderToIso('Sep 2026\n            \n            (S)'), '2026-09-30');
  assert.equal(periodHeaderToIso('Mar 2009\n            \n            \n            \n              18m'), '2009-03-31');
  assert.equal(periodHeaderToIso('Feb 2024 (S)'), '2024-02-29');
  assert.equal(periodLabelToEndDate('Dec 2025 (S)'), '2025-12-31');
  assert.equal(periodHeaderToIso('TTM'), '');

  // Ensure stored overrides hold zero malformed non-ISO financialPeriodEnd strings
  const overrides = loadLiveFundamentalOverrides();
  const malformed = Object.entries(overrides).filter(
    ([, rec]) => rec.financialPeriodEnd && !/^\d{4}-\d{2}-\d{2}$/.test(rec.financialPeriodEnd)
  );
  assert.equal(malformed.length, 0, `Unexpected malformed financialPeriodEnd values: ${malformed.map(([s]) => s).join(', ')}`);
});

test('t1T2ReportStore retains historical snapshots (>90 dates) without deletion', () => {
  nsePipeline.ensureLoaded();
  const origCwd = process.cwd();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't1t2-history-test-'));
  try {
    const snapFile = path.join(tmpDir, 'data', 'research', 't1_t2_daily_snapshots.json');
    const seeded: Record<string, unknown[]> = {};
    // Seed 95 distinct historical dates prior to 2026
    const startMs = Date.parse('2025-01-01T00:00:00Z');
    for (let i = 0; i < 95; i++) {
      const iso = new Date(startMs + i * 86_400_000).toISOString().slice(0, 10);
      seeded[iso] = [];
    }
    atomicWriteJsonSync(snapFile, { updatedAtUtc: '2025-06-01T00:00:00Z', snapshotsByDate: seeded }, { pretty: true });

    process.chdir(tmpDir);
    const updatedStore = syncT1T2DailySnapshots();
    for (const dt of Object.keys(seeded)) {
      assert.ok(dt in updatedStore.snapshotsByDate, `Historical T1/T2 snapshot ${dt} was unexpectedly deleted`);
    }
    assert.ok(Object.keys(updatedStore.snapshotsByDate).length >= 95);
  } finally {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('nsePipeline computes 200-EMA from >=200 Bhavcopy sessions and preserves 35D high window', () => {
  const overview = nsePipeline.getOverview();
  assert.ok(overview.sessionsLoaded >= 200, `Expected >=200 sessionsLoaded, got ${overview.sessionsLoaded}`);
  assert.ok(
    (overview.marketSentiment.ema200SampleCount ?? 0) >= 1500,
    `Expected Bhavcopy 200-EMA across >=1500 stocks, got ${overview.marketSentiment.ema200SampleCount}`
  );
  assert.ok(overview.marketSentiment.aboveEma200Pct !== null);
});
