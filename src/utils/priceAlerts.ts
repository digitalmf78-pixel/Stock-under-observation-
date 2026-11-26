export type PriceAlertCondition = 'ABOVE_OR_EQUAL' | 'BELOW_OR_EQUAL';

export interface PriceAlertRule {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: PriceAlertCondition;
  referencePriceAtCreation: number;
  note?: string;
  createdAt: string;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  dismissed: boolean;
}

export const PRICE_ALERTS_STORAGE_KEY = 'nse_scanner_price_alerts_v1';
export const PRICE_ALERTS_UPDATED_EVENT = 'price-alerts-updated';

function emitAlertsUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PRICE_ALERTS_UPDATED_EVENT));
  }
}

export function loadPriceAlerts(): PriceAlertRule[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(PRICE_ALERTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PriceAlertRule =>
        Boolean(item) &&
        typeof item.id === 'string' &&
        typeof item.symbol === 'string' &&
        typeof item.targetPrice === 'number' &&
        Number.isFinite(item.targetPrice) &&
        (item.condition === 'ABOVE_OR_EQUAL' || item.condition === 'BELOW_OR_EQUAL')
    );
  } catch {
    return [];
  }
}

export function savePriceAlerts(alerts: PriceAlertRule[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(PRICE_ALERTS_STORAGE_KEY, JSON.stringify(alerts));
    emitAlertsUpdated();
  } catch {
    // ignore quota errors
  }
}

export function createPriceAlert(input: {
  symbol: string;
  targetPrice: number;
  condition: PriceAlertCondition;
  referencePriceAtCreation: number;
  note?: string;
}): PriceAlertRule {
  const cleanSymbol = input.symbol.trim().toUpperCase();
  const cleanTarget = Number(input.targetPrice.toFixed(2));
  const cleanRef = Number(input.referencePriceAtCreation.toFixed(2));
  const nowIso = new Date().toISOString();

  const crossedImmediately =
    input.condition === 'ABOVE_OR_EQUAL'
      ? cleanRef >= cleanTarget
      : cleanRef <= cleanTarget;

  const newRule: PriceAlertRule = {
    id: `${cleanSymbol}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    symbol: cleanSymbol,
    targetPrice: cleanTarget,
    condition: input.condition,
    referencePriceAtCreation: cleanRef,
    note: input.note?.trim() || undefined,
    createdAt: nowIso,
    triggeredAt: crossedImmediately ? nowIso : null,
    triggeredPrice: crossedImmediately ? cleanRef : null,
    dismissed: false,
  };

  const existing = loadPriceAlerts();
  savePriceAlerts([newRule, ...existing]);
  return newRule;
}

export function deletePriceAlert(id: string): void {
  const existing = loadPriceAlerts();
  const next = existing.filter((a) => a.id !== id);
  if (next.length !== existing.length) {
    savePriceAlerts(next);
  }
}

export function dismissPriceAlertToast(id: string): void {
  const existing = loadPriceAlerts();
  let changed = false;
  const next = existing.map((a) => {
    if (a.id === id && !a.dismissed) {
      changed = true;
      return { ...a, dismissed: true };
    }
    return a;
  });
  if (changed) savePriceAlerts(next);
}

export function rearmPriceAlert(id: string): void {
  const existing = loadPriceAlerts();
  let changed = false;
  const next = existing.map((a) => {
    if (a.id === id) {
      changed = true;
      return {
        ...a,
        triggeredAt: null,
        triggeredPrice: null,
        dismissed: false,
      };
    }
    return a;
  });
  if (changed) savePriceAlerts(next);
}

export function evaluatePriceAlerts(
  pricesBySymbol: Record<string, number | null | undefined>
): PriceAlertRule[] {
  const normalizedPrices = new Map<string, number>();
  for (const [sym, price] of Object.entries(pricesBySymbol)) {
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      normalizedPrices.set(sym.trim().toUpperCase(), price);
    }
  }
  if (normalizedPrices.size === 0) return [];

  const existing = loadPriceAlerts();
  if (existing.length === 0) return [];

  const nowIso = new Date().toISOString();
  const newlyTriggered: PriceAlertRule[] = [];
  let changed = false;

  const next = existing.map((rule) => {
    if (rule.triggeredAt !== null) return rule;
    const currentPrice = normalizedPrices.get(rule.symbol.toUpperCase());
    if (currentPrice === undefined) return rule;

    const hit =
      rule.condition === 'ABOVE_OR_EQUAL'
        ? currentPrice >= rule.targetPrice
        : currentPrice <= rule.targetPrice;

    if (!hit) return rule;

    changed = true;
    const updated: PriceAlertRule = {
      ...rule,
      triggeredAt: nowIso,
      triggeredPrice: Number(currentPrice.toFixed(2)),
      dismissed: false,
    };
    newlyTriggered.push(updated);
    return updated;
  });

  if (changed) {
    savePriceAlerts(next);
  }
  return newlyTriggered;
}
