import path from 'node:path';
import type { ScreenerRow, WatchlistResponse } from '../src/types/trading.ts';
import { atomicWriteJsonSync, readJsonSafe } from './filePersistence.ts';

interface WatchlistFile {
  updatedAtUtc: string;
  symbols: string[];
}

function watchlistFilePath(): string {
  return path.join(process.cwd(), 'data', 'research', 'watchlist.json');
}

function isWatchlistShape(val: unknown): val is Partial<WatchlistFile> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function loadWatchlistSymbolsInternal(throwOnCorruptWithoutBackup = false): string[] {
  const parsed = readJsonSafe<Partial<WatchlistFile>>(
    watchlistFilePath(),
    { updatedAtUtc: '', symbols: [] },
    {
      validate: isWatchlistShape,
      throwOnCorruptWithoutBackup,
    }
  );
  if (!Array.isArray(parsed.symbols)) return [];
  return Array.from(
    new Set(
      parsed.symbols
        .map((s) => (typeof s === 'string' ? s.trim().toUpperCase() : ''))
        .filter(Boolean)
    )
  );
}

export function loadWatchlistSymbols(): string[] {
  return loadWatchlistSymbolsInternal(false);
}

export function saveWatchlistSymbols(symbols: string[]): string[] {
  const clean = Array.from(
    new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))
  );
  atomicWriteJsonSync(
    watchlistFilePath(),
    {
      updatedAtUtc: new Date().toISOString(),
      symbols: clean,
    },
    { pretty: true, preserveBackup: true }
  );
  return clean;
}

export function toggleWatchlistSymbol(symbol: string): {
  starred: boolean;
  symbols: string[];
} {
  const sym = symbol.trim().toUpperCase();
  if (!sym) throw new Error('Symbol is required.');
  const existing = loadWatchlistSymbolsInternal(true);
  const has = existing.includes(sym);
  const next = has ? existing.filter((s) => s !== sym) : [sym, ...existing];
  const saved = saveWatchlistSymbols(next);
  return { starred: !has, symbols: saved };
}

export function removeWatchlistSymbol(symbol: string): string[] {
  const sym = symbol.trim().toUpperCase();
  const existing = loadWatchlistSymbolsInternal(true);
  return saveWatchlistSymbols(existing.filter((s) => s !== sym));
}

export function isUTurnEntryTrigger(row: ScreenerRow): boolean {
  return (
    row.uTurnStatus === 'ACTIVE_TRIGGER' ||
    row.uTurnStatus === 'CONFIRMED_SUPPORT'
  );
}

export function buildWatchlistResponse(allRows: ScreenerRow[]): WatchlistResponse {
  const symbols = loadWatchlistSymbols();
  const bySymbol = new Map<string, ScreenerRow>();
  for (const r of allRows) {
    bySymbol.set(r.symbol, r);
  }

  const items = symbols
    .map((s) => bySymbol.get(s))
    .filter((r): r is ScreenerRow => Boolean(r));

  const statusRank = (s: ScreenerRow['uTurnStatus']): number => {
    if (s === 'ACTIVE_TRIGGER') return 3;
    if (s === 'CONFIRMED_SUPPORT') return 2;
    if (s === 'SUPPORT_HOLD' || s === 'IN_ZONE') return 1;
    return 0;
  };

  items.sort((a, b) => {
    const uDiff = statusRank(b.uTurnStatus) - statusRank(a.uTurnStatus);
    if (uDiff !== 0) return uDiff;
    return (b.rvol ?? -1) - (a.rvol ?? -1);
  });

  const triggered = items.filter(isUTurnEntryTrigger);

  return {
    symbols,
    items,
    triggered,
    triggeredCount: triggered.length,
  };
}
