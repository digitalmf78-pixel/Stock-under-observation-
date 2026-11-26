import fs from 'node:fs';
import path from 'node:path';
import type { ScreenerRow, WatchlistResponse } from '../src/types/trading.ts';

interface WatchlistFile {
  updatedAtUtc: string;
  symbols: string[];
}

function watchlistFilePath(): string {
  return path.join(process.cwd(), 'data', 'research', 'watchlist.json');
}

function atomicWriteJson(filePath: string, data: WatchlistFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
}

export function loadWatchlistSymbols(): string[] {
  const file = watchlistFilePath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as WatchlistFile;
    if (!Array.isArray(parsed?.symbols)) return [];
    return Array.from(
      new Set(
        parsed.symbols
          .map((s) => (typeof s === 'string' ? s.trim().toUpperCase() : ''))
          .filter(Boolean)
      )
    );
  } catch {
    return [];
  }
}

export function saveWatchlistSymbols(symbols: string[]): string[] {
  const clean = Array.from(
    new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))
  );
  atomicWriteJson(watchlistFilePath(), {
    updatedAtUtc: new Date().toISOString(),
    symbols: clean,
  });
  return clean;
}

export function toggleWatchlistSymbol(symbol: string): {
  starred: boolean;
  symbols: string[];
} {
  const sym = symbol.trim().toUpperCase();
  if (!sym) throw new Error('Symbol is required.');
  const existing = loadWatchlistSymbols();
  const has = existing.includes(sym);
  const next = has ? existing.filter((s) => s !== sym) : [sym, ...existing];
  const saved = saveWatchlistSymbols(next);
  return { starred: !has, symbols: saved };
}

export function removeWatchlistSymbol(symbol: string): string[] {
  const sym = symbol.trim().toUpperCase();
  const existing = loadWatchlistSymbols();
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
