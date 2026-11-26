import fs from 'node:fs';
import path from 'node:path';
import type {
  LiveStockQuote,
  T1T2DailyPresenceStatus,
  T1T2DailyReportItem,
  T1T2DailyReportResponse,
} from '../src/types/trading.ts';
import { toIstDateIso } from './liveFetcher.ts';
import { nsePipeline } from './nsePipeline.ts';
import { fetchLiveYahooQuote } from './paperTradeStore.ts';

interface StoredSnapshotEntry {
  symbol: string;
  companyName: string;
  sector: string;
  isIpo: boolean;
  listingDate: string;
  sessionsCount: number;
  swingTier: 'TIER_1_READY' | 'TIER_2_ACCUMULATION';
  closePrice: number;
  changePct: number | null;
  rvol: number | null;
  delivPer: number | null;
  delivQtyRatio: number | null;
  rsi14: number | null;
  ema21: number | null;
  aboveEma21: boolean | null;
  avgTurnover20DCr: number | null;
}

interface T1T2SnapshotsFile {
  updatedAtUtc: string;
  snapshotsByDate: Record<string, StoredSnapshotEntry[]>;
}

function snapshotsFilePath(): string {
  return path.join(process.cwd(), 'data', 'research', 't1_t2_daily_snapshots.json');
}

function atomicWriteJson(filePath: string, data: T1T2SnapshotsFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
}

function loadSnapshotsFile(): T1T2SnapshotsFile {
  const file = snapshotsFilePath();
  if (!fs.existsSync(file)) {
    return { updatedAtUtc: '', snapshotsByDate: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as T1T2SnapshotsFile;
    return {
      updatedAtUtc: parsed?.updatedAtUtc || '',
      snapshotsByDate:
        parsed?.snapshotsByDate && typeof parsed.snapshotsByDate === 'object'
          ? parsed.snapshotsByDate
          : {},
    };
  } catch {
    return { updatedAtUtc: '', snapshotsByDate: {} };
  }
}

export function syncT1T2DailySnapshots(): T1T2SnapshotsFile {
  const { latestDate, sessionDates } = nsePipeline.getScreenerSessionMeta();
  const store = loadSnapshotsFile();
  let dirty = false;

  // Backfill up to the latest 10 Bhavcopy sessions if not yet memorized, and always refresh latestDate
  const recentDates = sessionDates.slice(-10);
  for (const dt of recentDates) {
    if (!store.snapshotsByDate[dt] || dt === latestDate) {
      const snap = nsePipeline.getT1T2SnapshotForDate(dt);
      const prevLen = store.snapshotsByDate[dt]?.length ?? -1;
      const newStr = JSON.stringify(snap);
      const oldStr = store.snapshotsByDate[dt] ? JSON.stringify(store.snapshotsByDate[dt]) : '';
      if (prevLen === -1 || newStr !== oldStr) {
        store.snapshotsByDate[dt] = snap;
        dirty = true;
      }
    }
  }

  // Retain up to 90 trading dates in persistent memory
  const allDates = Object.keys(store.snapshotsByDate).sort();
  if (allDates.length > 90) {
    const toDrop = allDates.slice(0, allDates.length - 90);
    for (const d of toDrop) {
      delete store.snapshotsByDate[d];
      dirty = true;
    }
  }

  if (dirty) {
    store.updatedAtUtc = new Date().toISOString();
    atomicWriteJson(snapshotsFilePath(), store);
  }

  return store;
}

export async function buildT1T2DailyReport(options?: {
  includeLive?: boolean;
  forceRefresh?: boolean;
}): Promise<T1T2DailyReportResponse> {
  const store = syncT1T2DailySnapshots();
  const { latestDate, rows: allScreenerRows } = nsePipeline.getScreenerSessionMeta();

  const memorizedDates = Object.keys(store.snapshotsByDate).sort();
  const todayDate =
    latestDate || memorizedDates[memorizedDates.length - 1] || toIstDateIso();
  const priorDates = memorizedDates.filter((d) => d < todayDate);
  const yesterdayDate = priorDates.length > 0 ? priorDates[priorDates.length - 1] : null;

  const todayEntries = store.snapshotsByDate[todayDate] || [];
  const yesterdayEntries = yesterdayDate ? store.snapshotsByDate[yesterdayDate] || [] : [];

  const todayMap = new Map<string, StoredSnapshotEntry>();
  for (const e of todayEntries) todayMap.set(e.symbol, e);

  const yesterdayMap = new Map<string, StoredSnapshotEntry>();
  for (const e of yesterdayEntries) yesterdayMap.set(e.symbol, e);

  const screenerBySym = new Map(allScreenerRows.map((r) => [r.symbol, r]));

  // Build symbol -> Set of memorized dates appeared in T1/T2
  const dateSetsBySymbol = new Map<string, Set<string>>();
  for (const dt of memorizedDates) {
    const list = store.snapshotsByDate[dt] || [];
    for (const item of list) {
      let set = dateSetsBySymbol.get(item.symbol);
      if (!set) {
        set = new Set<string>();
        dateSetsBySymbol.set(item.symbol, set);
      }
      set.add(dt);
    }
  }

  const allReportSymbols = Array.from(
    new Set<string>([...todayMap.keys(), ...yesterdayMap.keys()])
  );

  // Optionally fetch Yahoo Finance live quotes in chunks of 8
  const liveMap = new Map<string, LiveStockQuote>();
  if (options?.includeLive) {
    const force = options?.forceRefresh === true;
    for (let i = 0; i < allReportSymbols.length; i += 8) {
      const chunk = allReportSymbols.slice(i, i + 8);
      const quotes = await Promise.all(
        chunk.map((sym) => fetchLiveYahooQuote(sym, force))
      );
      for (let j = 0; j < chunk.length; j++) {
        liveMap.set(chunk[j], quotes[j]);
      }
    }
  }

  const datesDesc = [...memorizedDates].sort((a, b) => b.localeCompare(a));

  const items: T1T2DailyReportItem[] = allReportSymbols.map((sym) => {
    const tEntry = todayMap.get(sym);
    const yEntry = yesterdayMap.get(sym);
    const cur = screenerBySym.get(sym);
    const base = tEntry || yEntry!;

    const todayTier = tEntry ? tEntry.swingTier : 'NONE';
    const yesterdayTier = yEntry ? yEntry.swingTier : 'NONE';

    let presenceStatus: T1T2DailyPresenceStatus = 'NEW_TODAY';
    if (tEntry && yEntry) presenceStatus = 'DAILY_REPEAT';
    else if (tEntry && !yEntry) presenceStatus = 'NEW_TODAY';
    else presenceStatus = 'YESTERDAY_ONLY';

    const seenSet = dateSetsBySymbol.get(sym) || new Set<string>();
    const datesAppeared = Array.from(seenSet).sort((a, b) => b.localeCompare(a));

    // Compute consecutive trading days in memorizedDates ending at todayDate (or yesterdayDate if YESTERDAY_ONLY)
    const startDate = tEntry ? todayDate : yesterdayDate || todayDate;
    let consecutiveDays = 0;
    let started = false;
    for (const dt of datesDesc) {
      if (dt > startDate) continue;
      started = true;
      if (seenSet.has(dt)) consecutiveDays++;
      else if (started) break;
    }

    const scannerEodClose = cur?.closePrice ?? base.closePrice;
    const liveQ = liveMap.get(sym);
    const livePrice = liveQ?.available && liveQ.livePrice !== null ? liveQ.livePrice : null;
    const liveVsScannerEodInr =
      livePrice !== null ? Number((livePrice - scannerEodClose).toFixed(2)) : null;
    const liveVsScannerEodPct =
      livePrice !== null && scannerEodClose > 0
        ? Number((((livePrice - scannerEodClose) / scannerEodClose) * 100).toFixed(2))
        : null;

    const isIpo = cur?.isIpo ?? base.isIpo;
    const sector =
      cur?.providerSector || base.sector || (isIpo ? 'IPO / Recent Listings' : 'Unclassified');

    return {
      symbol: sym,
      companyName: cur?.companyName || base.companyName || '',
      sector,
      isIpo,
      marketCapCr: cur?.marketCapCr ?? null,
      marketCapCategory: cur?.marketCapCategory ?? 'UNKNOWN',
      listingDate: cur?.listingDate || base.listingDate || '',
      sessionsCount: cur?.sessionsCount ?? base.sessionsCount,
      todayTier,
      yesterdayTier,
      presenceStatus,
      consecutiveDays,
      daysSeenInHistory: datesAppeared.length,
      datesAppeared,
      scannerEodClose,
      yesterdayEodClose: yEntry ? yEntry.closePrice : null,
      eodChangePct: cur?.changePct ?? base.changePct,
      rvol: cur?.rvol ?? base.rvol,
      delivPer: cur?.delivPer ?? base.delivPer,
      delivQtyRatio: cur?.delivQtyRatio ?? base.delivQtyRatio,
      rsi14: cur?.rsi14 ?? base.rsi14,
      ema21: cur?.ema21 ?? base.ema21,
      aboveEma21: cur?.aboveEma21 ?? base.aboveEma21,
      ema21AboveEma44: cur?.ema21AboveEma44 ?? null,
      ema21Cross44Bullish: cur?.ema21Cross44Bullish ?? false,
      avgTurnover20DCr: cur?.avgTurnover20DCr ?? base.avgTurnover20DCr,
      uTurnStatus: cur?.uTurnStatus ?? null,
      fundamentalCoverage: cur?.fundamentalCoverage ?? 'MISSING',
      fundamentalFreshness: cur?.fundamentalFreshness ?? 'NOT_AVAILABLE',
      livePrice,
      liveVsScannerEodPct,
      liveVsScannerEodInr,
      liveLastUpdated: liveQ?.available ? liveQ.lastUpdated ?? null : null,
      liveMarketTimeIst: liveQ?.available ? liveQ.marketTimeIst : '',
      liveMarketDateIst: liveQ?.available ? liveQ.marketDateIst ?? null : null,
      liveMarketState: liveQ?.available ? liveQ.marketState : '',
      liveIsStale: liveQ?.available ? Boolean(liveQ.isStale) : undefined,
      liveSourceNote: liveQ
        ? liveQ.available
          ? liveQ.marketTimeIst || 'Yahoo Finance'
          : 'DATA NOT AVAILABLE'
        : '',
    };
  });

  // Sort: DAILY_REPEAT first, then NEW_TODAY, then YESTERDAY_ONLY; within group T1 before T2, then IPOs/RVOL
  const presenceRank: Record<T1T2DailyPresenceStatus, number> = {
    DAILY_REPEAT: 0,
    NEW_TODAY: 1,
    YESTERDAY_ONLY: 2,
  };
  const tierRank = { TIER_1_READY: 0, TIER_2_ACCUMULATION: 1, NONE: 2 };

  items.sort((a, b) => {
    const pDiff = presenceRank[a.presenceStatus] - presenceRank[b.presenceStatus];
    if (pDiff !== 0) return pDiff;
    const tDiff = tierRank[a.todayTier] - tierRank[b.todayTier];
    if (tDiff !== 0) return tDiff;
    const cDiff = b.consecutiveDays - a.consecutiveDays;
    if (cDiff !== 0) return cDiff;
    return (b.rvol ?? -1) - (a.rvol ?? -1);
  });

  const todayItems = items.filter((i) => i.todayTier !== 'NONE');
  const todayT1 = todayItems.filter((i) => i.todayTier === 'TIER_1_READY').length;
  const todayT2 = todayItems.filter((i) => i.todayTier === 'TIER_2_ACCUMULATION').length;
  const todayIpoCount = todayItems.filter((i) => i.isIpo).length;

  return {
    todayDate,
    yesterdayDate,
    memorizedDates,
    counts: {
      todayTotal: todayItems.length,
      todayT1,
      todayT2,
      todayIpoCount,
      yesterdayTotal: items.filter((i) => i.yesterdayTier !== 'NONE').length,
      dailyRepeatCount: items.filter((i) => i.presenceStatus === 'DAILY_REPEAT').length,
      newTodayCount: items.filter((i) => i.presenceStatus === 'NEW_TODAY').length,
      yesterdayOnlyCount: items.filter((i) => i.presenceStatus === 'YESTERDAY_ONLY').length,
    },
    items,
  };
}

function csvCell(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function formatT1T2ReportCsv(report: T1T2DailyReportResponse): string {
  const headers = [
    'TodayDate',
    'YesterdayDate',
    'PresenceStatus',
    'DailyRepeaterFlag',
    'ConsecutiveDaysInT1T2',
    'DaysSeenInHistory',
    'DatesAppeared',
    'Symbol',
    'CompanyName',
    'IsIPO',
    'MarketCapCategory',
    'MarketCapCr',
    'Sector',
    'TodayTier',
    'YesterdayTier',
    'ScannerEodCloseINR',
    'YesterdayEodCloseINR',
    'EodChangePct',
    'LivePriceINR',
    'LiveVsScannerEodINR',
    'LiveVsScannerEodPct',
    'RVOL',
    'DelivPct',
    'DelivQtyRatio',
    'RSI14',
    'EMA21',
    'AboveEMA21',
    'EMA21AboveEMA44',
    'EMA21Cross44Bullish',
    'AvgTurnover20DCr',
    'UTurnStatus',
    'FundamentalCoverage',
    'FundamentalFreshness',
    'ListingDate',
    'SessionsCount',
    'LiveTimestampOrNote',
  ];

  const lines = [headers.join(',')];
  for (const row of report.items) {
    lines.push(
      [
        csvCell(report.todayDate),
        csvCell(report.yesterdayDate || ''),
        csvCell(row.presenceStatus),
        csvCell(row.presenceStatus === 'DAILY_REPEAT' ? 'YES_DAILY_REPEAT' : 'NO'),
        csvCell(row.consecutiveDays),
        csvCell(row.daysSeenInHistory),
        csvCell(row.datesAppeared.join(' | ')),
        csvCell(row.symbol),
        csvCell(row.companyName),
        csvCell(row.isIpo ? 'IPO' : 'MAINBOARD'),
        csvCell(row.marketCapCategory),
        csvCell(row.marketCapCr ?? ''),
        csvCell(row.sector),
        csvCell(row.todayTier),
        csvCell(row.yesterdayTier),
        csvCell(row.scannerEodClose.toFixed(2)),
        csvCell(row.yesterdayEodClose !== null ? row.yesterdayEodClose.toFixed(2) : ''),
        csvCell(row.eodChangePct !== null ? row.eodChangePct.toFixed(2) : ''),
        csvCell(row.livePrice !== null ? row.livePrice.toFixed(2) : 'DATA NOT AVAILABLE'),
        csvCell(row.liveVsScannerEodInr !== null ? row.liveVsScannerEodInr.toFixed(2) : ''),
        csvCell(row.liveVsScannerEodPct !== null ? row.liveVsScannerEodPct.toFixed(2) : ''),
        csvCell(row.rvol !== null ? row.rvol.toFixed(2) : ''),
        csvCell(row.delivPer !== null ? row.delivPer.toFixed(2) : ''),
        csvCell(row.delivQtyRatio !== null ? row.delivQtyRatio.toFixed(2) : ''),
        csvCell(row.rsi14 !== null ? row.rsi14.toFixed(1) : ''),
        csvCell(row.ema21 !== null ? row.ema21.toFixed(2) : ''),
        csvCell(row.aboveEma21 === null ? '' : row.aboveEma21 ? 'YES' : 'NO'),
        csvCell(row.ema21AboveEma44 === null ? '' : row.ema21AboveEma44 ? 'YES' : 'NO'),
        csvCell(row.ema21Cross44Bullish ? 'YES' : 'NO'),
        csvCell(row.avgTurnover20DCr !== null ? row.avgTurnover20DCr.toFixed(2) : ''),
        csvCell(row.uTurnStatus ?? ''),
        csvCell(row.fundamentalCoverage),
        csvCell(row.fundamentalFreshness),
        csvCell(row.listingDate),
        csvCell(row.sessionsCount),
        csvCell(row.liveSourceNote),
      ].join(',')
    );
  }
  return lines.join('\n');
}
