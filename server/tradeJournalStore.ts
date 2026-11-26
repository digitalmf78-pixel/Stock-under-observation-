import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  TradeJournalAction,
  TradeJournalEntry,
  TradeJournalSentiment,
} from '../src/types/trading.ts';
import { toIstDateIso } from './liveFetcher.ts';

interface TradeJournalFile {
  updatedAtUtc: string;
  entries: TradeJournalEntry[];
}

function journalFilePath(): string {
  return path.join(process.cwd(), 'data', 'research', 'trade_journal.json');
}

function atomicWriteJson(filePath: string, data: TradeJournalFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, filePath);
}

function loadJournalFile(): TradeJournalFile {
  const file = journalFilePath();
  if (!fs.existsSync(file)) {
    return { updatedAtUtc: '', entries: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as TradeJournalFile;
    return {
      updatedAtUtc: parsed?.updatedAtUtc || '',
      entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
    };
  } catch {
    return { updatedAtUtc: '', entries: [] };
  }
}

function normalizePrice(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Number(num.toFixed(2));
}

function computePnlPct(entryPrice: number | null, exitPrice: number | null): number | null {
  if (entryPrice !== null && exitPrice !== null && entryPrice > 0) {
    return Number((((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2));
  }
  return null;
}

function normalizeAction(val: unknown): TradeJournalAction {
  const raw = typeof val === 'string' ? val.trim().toUpperCase() : '';
  if (raw === 'ENTERED' || raw === 'EXITED' || raw === 'SKIPPED') return raw;
  return 'WATCHING';
}

function normalizeSentiment(val: unknown): TradeJournalSentiment {
  const raw = typeof val === 'string' ? val.trim().toUpperCase() : '';
  if (raw === 'BULLISH' || raw === 'BEARISH') return raw;
  return 'NEUTRAL';
}

function sortEntries(entries: TradeJournalEntry[]): TradeJournalEntry[] {
  return [...entries].sort((a, b) => {
    const d = b.tradeDate.localeCompare(a.tradeDate);
    if (d !== 0) return d;
    return b.createdAtUtc.localeCompare(a.createdAtUtc);
  });
}

export function listTradeJournalEntries(symbol?: string): TradeJournalEntry[] {
  const file = loadJournalFile();
  const sym = symbol ? symbol.trim().toUpperCase() : '';
  const filtered = sym ? file.entries.filter((e) => e.symbol === sym) : file.entries;
  return sortEntries(filtered);
}

export interface CreateTradeJournalInput {
  symbol: string;
  tradeDate?: string;
  action?: unknown;
  entryPrice?: unknown;
  exitPrice?: unknown;
  stopLoss?: unknown;
  sentiment?: unknown;
  setupTag?: unknown;
  entryExitNotes?: unknown;
  sentimentNotes?: unknown;
  lessonsLearned?: unknown;
}

export function createTradeJournalEntry(input: CreateTradeJournalInput): {
  entry: TradeJournalEntry;
  entries: TradeJournalEntry[];
} {
  const sym = input.symbol.trim().toUpperCase();
  if (!sym) throw new Error('Symbol is required.');

  const entryExitNotes = typeof input.entryExitNotes === 'string' ? input.entryExitNotes.trim() : '';
  const sentimentNotes = typeof input.sentimentNotes === 'string' ? input.sentimentNotes.trim() : '';
  const lessonsLearned = typeof input.lessonsLearned === 'string' ? input.lessonsLearned.trim() : '';

  if (!entryExitNotes && !sentimentNotes && !lessonsLearned) {
    throw new Error('Provide at least one note (Entry/Exit, Sentiment, or Lesson Learned).');
  }

  const tradeDate =
    typeof input.tradeDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate.trim())
      ? input.tradeDate.trim()
      : toIstDateIso();

  const entryPrice = normalizePrice(input.entryPrice);
  const exitPrice = normalizePrice(input.exitPrice);
  const stopLoss = normalizePrice(input.stopLoss);
  const nowUtc = new Date().toISOString();

  const entry: TradeJournalEntry = {
    id: crypto.randomUUID(),
    symbol: sym,
    tradeDate,
    action: normalizeAction(input.action),
    entryPrice,
    exitPrice,
    stopLoss,
    sentiment: normalizeSentiment(input.sentiment),
    setupTag: typeof input.setupTag === 'string' ? input.setupTag.trim().slice(0, 80) : '',
    entryExitNotes,
    sentimentNotes,
    lessonsLearned,
    pnlPct: computePnlPct(entryPrice, exitPrice),
    createdAtUtc: nowUtc,
    updatedAtUtc: nowUtc,
  };

  const file = loadJournalFile();
  const nextEntries = [entry, ...file.entries];
  atomicWriteJson(journalFilePath(), {
    updatedAtUtc: nowUtc,
    entries: nextEntries,
  });

  return {
    entry,
    entries: sortEntries(nextEntries.filter((e) => e.symbol === sym)),
  };
}

export function updateTradeJournalEntry(
  symbol: string,
  id: string,
  patch: Omit<CreateTradeJournalInput, 'symbol'>
): {
  entry: TradeJournalEntry;
  entries: TradeJournalEntry[];
} {
  const sym = symbol.trim().toUpperCase();
  const file = loadJournalFile();
  const idx = file.entries.findIndex((e) => e.id === id && e.symbol === sym);
  if (idx < 0) {
    throw new Error(`Journal entry ${id} not found for ${sym}.`);
  }

  const prev = file.entries[idx];
  const entryExitNotes =
    patch.entryExitNotes !== undefined
      ? typeof patch.entryExitNotes === 'string'
        ? patch.entryExitNotes.trim()
        : ''
      : prev.entryExitNotes;
  const sentimentNotes =
    patch.sentimentNotes !== undefined
      ? typeof patch.sentimentNotes === 'string'
        ? patch.sentimentNotes.trim()
        : ''
      : prev.sentimentNotes;
  const lessonsLearned =
    patch.lessonsLearned !== undefined
      ? typeof patch.lessonsLearned === 'string'
        ? patch.lessonsLearned.trim()
        : ''
      : prev.lessonsLearned;

  if (!entryExitNotes && !sentimentNotes && !lessonsLearned) {
    throw new Error('Provide at least one note (Entry/Exit, Sentiment, or Lesson Learned).');
  }

  const entryPrice =
    patch.entryPrice !== undefined ? normalizePrice(patch.entryPrice) : prev.entryPrice;
  const exitPrice =
    patch.exitPrice !== undefined ? normalizePrice(patch.exitPrice) : prev.exitPrice;
  const stopLoss = patch.stopLoss !== undefined ? normalizePrice(patch.stopLoss) : prev.stopLoss;
  const tradeDate =
    typeof patch.tradeDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.tradeDate.trim())
      ? patch.tradeDate.trim()
      : prev.tradeDate;

  const updated: TradeJournalEntry = {
    ...prev,
    tradeDate,
    action: patch.action !== undefined ? normalizeAction(patch.action) : prev.action,
    entryPrice,
    exitPrice,
    stopLoss,
    sentiment: patch.sentiment !== undefined ? normalizeSentiment(patch.sentiment) : prev.sentiment,
    setupTag:
      patch.setupTag !== undefined
        ? typeof patch.setupTag === 'string'
          ? patch.setupTag.trim().slice(0, 80)
          : ''
        : prev.setupTag,
    entryExitNotes,
    sentimentNotes,
    lessonsLearned,
    pnlPct: computePnlPct(entryPrice, exitPrice),
    updatedAtUtc: new Date().toISOString(),
  };

  file.entries[idx] = updated;
  atomicWriteJson(journalFilePath(), {
    updatedAtUtc: updated.updatedAtUtc,
    entries: file.entries,
  });

  return {
    entry: updated,
    entries: sortEntries(file.entries.filter((e) => e.symbol === sym)),
  };
}

export function deleteTradeJournalEntry(
  symbol: string,
  id: string
): { deleted: boolean; entries: TradeJournalEntry[] } {
  const sym = symbol.trim().toUpperCase();
  const file = loadJournalFile();
  const next = file.entries.filter((e) => !(e.id === id && e.symbol === sym));
  const deleted = next.length !== file.entries.length;
  if (!deleted) {
    throw new Error(`Journal entry ${id} not found for ${sym}.`);
  }
  atomicWriteJson(journalFilePath(), {
    updatedAtUtc: new Date().toISOString(),
    entries: next,
  });
  return {
    deleted: true,
    entries: sortEntries(next.filter((e) => e.symbol === sym)),
  };
}
