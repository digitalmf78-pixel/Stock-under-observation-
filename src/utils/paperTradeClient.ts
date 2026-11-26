import type { PaperPortfolioSummary, PaperTrade, PaperTradeMarked } from '../types/trading';

const VAULT_STORAGE_KEY = 'nse_scanner_paper_vault_v1';

interface PaperVaultPayload {
  updatedAtUtc: string;
  trades: PaperTrade[];
  deletedIds: string[];
}

function stripMarks(t: PaperTrade | PaperTradeMarked): PaperTrade {
  return {
    id: t.id,
    symbol: String(t.symbol || '').trim().toUpperCase(),
    sector: t.sector || 'Unclassified',
    strategyTag: t.strategyTag || 'Manual',
    status: t.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
    quantity: Number(t.quantity) || 1,
    entryDate: t.entryDate || new Date().toISOString().slice(0, 10),
    entryPrice: Number(t.entryPrice) || 0,
    entryPriceSource: t.entryPriceSource || 'MANUAL',
    stopLoss: t.stopLoss ?? null,
    targetPrice: t.targetPrice ?? null,
    exitDate: t.exitDate ?? null,
    exitPrice: t.exitPrice ?? null,
    exitPriceSource: t.exitPriceSource ?? null,
    realizedPnlInr: t.realizedPnlInr ?? null,
    realizedPnlPct: t.realizedPnlPct ?? null,
    rMultiple: t.rMultiple ?? null,
    notes: t.notes || '',
    createdAtUtc: t.createdAtUtc || new Date().toISOString(),
    closedAtUtc: t.closedAtUtc ?? null,
  };
}

export function readPaperVault(): PaperVaultPayload {
  if (typeof window === 'undefined') {
    return { updatedAtUtc: '', trades: [], deletedIds: [] };
  }
  try {
    const raw = window.localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return { updatedAtUtc: '', trades: [], deletedIds: [] };
    const parsed = JSON.parse(raw) as Partial<PaperVaultPayload>;
    return {
      updatedAtUtc: typeof parsed.updatedAtUtc === 'string' ? parsed.updatedAtUtc : '',
      trades: Array.isArray(parsed.trades) ? parsed.trades.map(stripMarks) : [],
      deletedIds: Array.isArray(parsed.deletedIds)
        ? parsed.deletedIds.filter((x): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    return { updatedAtUtc: '', trades: [], deletedIds: [] };
  }
}

function writePaperVault(payload: PaperVaultPayload): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors gracefully
  }
}

function notifyPortfolioUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('paper-portfolio-updated'));
  }
}

export function getOpenVaultSymbolCounts(): Record<string, number> {
  const vault = readPaperVault();
  const counts: Record<string, number> = {};
  for (const t of vault.trades) {
    if (t.status === 'OPEN' && t.symbol) {
      const sym = t.symbol.toUpperCase();
      counts[sym] = (counts[sym] || 0) + 1;
    }
  }
  return counts;
}

export function mergePortfolioIntoVault(
  serverTrades: Array<PaperTrade | PaperTradeMarked>,
  extraTrade?: PaperTrade
): void {
  const vault = readPaperVault();
  const deletedSet = new Set(vault.deletedIds);
  const byId = new Map<string, PaperTrade>();

  for (const t of vault.trades) {
    if (!deletedSet.has(t.id)) {
      byId.set(t.id, stripMarks(t));
    }
  }
  for (const t of serverTrades) {
    if (!deletedSet.has(t.id)) {
      byId.set(t.id, stripMarks(t));
    }
  }
  if (extraTrade && !deletedSet.has(extraTrade.id)) {
    byId.set(extraTrade.id, stripMarks(extraTrade));
  }

  const merged = Array.from(byId.values()).sort((a, b) =>
    b.createdAtUtc.localeCompare(a.createdAtUtc)
  );
  writePaperVault({
    updatedAtUtc: new Date().toISOString(),
    trades: merged,
    deletedIds: vault.deletedIds.slice(-200),
  });
}

export function removeTradeFromVault(id: string): void {
  const vault = readPaperVault();
  const deletedSet = new Set(vault.deletedIds);
  deletedSet.add(id);
  writePaperVault({
    updatedAtUtc: new Date().toISOString(),
    trades: vault.trades.filter((t) => t.id !== id),
    deletedIds: Array.from(deletedSet).slice(-200),
  });
}

export function buildFallbackPortfolioFromVault(): PaperPortfolioSummary {
  const vault = readPaperVault();
  const marked: PaperTradeMarked[] = vault.trades.map((t) => ({
    ...t,
    currentPrice: t.status === 'CLOSED' ? t.exitPrice : t.entryPrice,
    currentPriceSource:
      t.status === 'CLOSED'
        ? t.exitPriceSource === 'LIVE_YAHOO'
          ? 'LIVE_YAHOO'
          : 'NSE_EOD'
        : 'DATA NOT AVAILABLE',
    unrealizedPnlInr: t.status === 'OPEN' ? 0 : null,
    unrealizedPnlPct: t.status === 'OPEN' ? 0 : null,
  }));
  const openTrades = marked.filter((t) => t.status === 'OPEN');
  const closedTrades = marked.filter((t) => t.status === 'CLOSED');
  const wins = closedTrades.filter((t) => (t.realizedPnlInr ?? 0) > 0).length;
  const losses = closedTrades.filter((t) => (t.realizedPnlInr ?? 0) <= 0).length;
  const totalRealizedPnlInr = Number(
    closedTrades.reduce((acc, t) => acc + (t.realizedPnlInr ?? 0), 0).toFixed(2)
  );
  const openCapitalInr = Number(
    openTrades.reduce((acc, t) => acc + t.entryPrice * t.quantity, 0).toFixed(2)
  );
  const closedInvestedCapitalInr = Number(
    closedTrades.reduce((acc, t) => acc + t.entryPrice * t.quantity, 0).toFixed(2)
  );

  return {
    trades: marked,
    stats: {
      totalTrades: marked.length,
      openCount: openTrades.length,
      closedCount: closedTrades.length,
      wins,
      losses,
      winRatePct: closedTrades.length > 0 ? Number(((wins / closedTrades.length) * 100).toFixed(1)) : null,
      totalRealizedPnlInr,
      totalUnrealizedPnlInr: 0,
      netPnlInr: totalRealizedPnlInr,
      avgReturnPct: null,
      avgWinPct: null,
      avgLossPct: null,
      avgRMultiple: null,
      profitFactor: null,
      openCapitalInr,
      closedInvestedCapitalInr,
      totalInvestedCapitalInr: Number((openCapitalInr + closedInvestedCapitalInr).toFixed(2)),
      realizedRoiPct: null,
      totalRoiPct: null,
    },
    byStrategy: [],
  };
}

export async function syncAndLoadPaperPortfolio(options?: {
  live?: boolean;
}): Promise<{ portfolio: PaperPortfolioSummary; restoredCount: number }> {
  const vault = readPaperVault();
  const res = await fetch('/api/paper-trades/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trades: vault.trades,
      deletedIds: vault.deletedIds,
      fetchLive: options?.live !== false,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

  const portfolio = json.portfolio as PaperPortfolioSummary;
  const serverIds = new Set(portfolio.trades.map((t) => t.id));
  // Persist authoritative merged trades to vault (and clear deletedIds already acknowledged)
  writePaperVault({
    updatedAtUtc: new Date().toISOString(),
    trades: portfolio.trades.map(stripMarks),
    deletedIds: vault.deletedIds.filter((id) => serverIds.has(id)).slice(-200),
  });
  notifyPortfolioUpdated();
  return {
    portfolio,
    restoredCount: Number(json.restoredCount) || 0,
  };
}

export async function executePaperBuy(payload: {
  symbol: string;
  quantity?: number;
  entryPrice?: number;
  stopLoss?: number;
  targetPrice?: number;
  strategyTag?: string;
  notes?: string;
  preferLive?: boolean;
}): Promise<{ trade: PaperTrade; portfolio: PaperPortfolioSummary }> {
  const res = await fetch('/api/paper-trades/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  mergePortfolioIntoVault(json.portfolio?.trades || [], json.trade);
  notifyPortfolioUpdated();
  return json as { trade: PaperTrade; portfolio: PaperPortfolioSummary };
}

export async function executePaperSell(
  id: string,
  payload?: { exitPrice?: number; notes?: string }
): Promise<{ trade: PaperTrade; portfolio: PaperPortfolioSummary }> {
  const res = await fetch(`/api/paper-trades/${encodeURIComponent(id)}/sell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  mergePortfolioIntoVault(json.portfolio?.trades || [], json.trade);
  notifyPortfolioUpdated();
  return json as { trade: PaperTrade; portfolio: PaperPortfolioSummary };
}

export async function executePaperDelete(id: string): Promise<PaperPortfolioSummary> {
  const res = await fetch(`/api/paper-trades/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  removeTradeFromVault(id);
  notifyPortfolioUpdated();
  return json as PaperPortfolioSummary;
}
