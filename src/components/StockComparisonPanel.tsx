import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  GitCompareArrows,
  Search,
  TrendingUp,
  X,
} from 'lucide-react';
import type { ScreenerRow, StockDetailData } from '../types/trading';

interface StockComparisonPanelProps {
  primaryData: StockDetailData;
  onSelectSymbol: (symbol: string) => void;
  onClose?: () => void;
}

type CompareViewMode = 'BOTH' | 'RVOL' | 'DELIVERY' | 'PRICE_NORM';

interface AlignedSessionPoint {
  date: string;
  primaryClose: number | null;
  secondaryClose: number | null;
  primaryNormPrice: number | null;
  secondaryNormPrice: number | null;
  primaryRvol: number | null;
  secondaryRvol: number | null;
  primaryDelivPer: number | null;
  secondaryDelivPer: number | null;
}

function buildRvolSeries(history: StockDetailData['history']): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (let i = 0; i < history.length; i++) {
    const row = history[i];
    if (typeof row.rvol === 'number' && Number.isFinite(row.rvol)) {
      out.set(row.date, row.rvol);
      continue;
    }
    if (i >= 3 && row.volume > 0) {
      const prior = history.slice(Math.max(0, i - 20), i);
      const avgVol =
        prior.reduce((sum, item) => sum + (item.volume > 0 ? item.volume : 0), 0) /
        prior.length;
      out.set(row.date, avgVol > 0 ? Number((row.volume / avgVol).toFixed(2)) : null);
    } else {
      out.set(row.date, null);
    }
  }
  return out;
}

function buildPolylineSegments(
  points: AlignedSessionPoint[],
  getValue: (p: AlignedSessionPoint) => number | null,
  xFor: (idx: number) => number,
  yFor: (val: number) => number
): string[] {
  const segments: string[] = [];
  let current: string[] = [];

  for (let i = 0; i < points.length; i++) {
    const val = getValue(points[i]);
    if (val !== null && Number.isFinite(val)) {
      current.push(`${xFor(i).toFixed(1)},${yFor(val).toFixed(1)}`);
    } else if (current.length > 0) {
      segments.push(current.join(' '));
      current = [];
    }
  }
  if (current.length > 0) {
    segments.push(current.join(' '));
  }
  return segments;
}

function computeAvg(nums: Array<number | null>): number | null {
  const valid = nums.filter((n): n is number => n !== null && Number.isFinite(n));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function computePeriodReturnPct(closes: Array<number | null>): number | null {
  const valid = closes.filter((c): c is number => c !== null && Number.isFinite(c) && c > 0);
  if (valid.length < 2) return null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  return ((last - first) / first) * 100;
}

export const StockComparisonPanel: React.FC<StockComparisonPanelProps> = ({
  primaryData,
  onSelectSymbol,
  onClose,
}) => {
  const primarySymbol = primaryData.summary.symbol;

  const suggestedPeers = useMemo(() => {
    const seen = new Set<string>([primarySymbol]);
    const list: string[] = [];
    for (const row of primaryData.fundamentalAuditRows || []) {
      const sym = row.symbol.trim().toUpperCase();
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        list.push(sym);
      }
      if (list.length >= 5) break;
    }
    return list;
  }, [primaryData.fundamentalAuditRows, primarySymbol]);

  const [tickerInput, setTickerInput] = useState('');
  const [secondarySymbol, setSecondarySymbol] = useState<string>('');
  const [secondaryData, setSecondaryData] = useState<StockDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<CompareViewMode>('BOTH');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const [suggestions, setSuggestions] = useState<ScreenerRow[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Close autocomplete dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (ev: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(ev.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset secondary if user switches primary onto the same ticker
  useEffect(() => {
    if (secondarySymbol && secondarySymbol === primarySymbol) {
      setSecondarySymbol('');
      setSecondaryData(null);
      setError(null);
    }
  }, [primarySymbol, secondarySymbol]);

  // Debounced ticker autocomplete via /api/screener
  useEffect(() => {
    const q = tickerInput.trim().toUpperCase();
    if (!q || q === secondarySymbol) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/screener?q=${encodeURIComponent(q)}&limit=7`,
          { signal: controller.signal }
        );
        if (!res.ok) return;
        const json = (await res.json()) as { rows?: ScreenerRow[] };
        const filtered = (json.rows || []).filter(
          (r) => r.symbol.toUpperCase() !== primarySymbol
        );
        setSuggestions(filtered);
      } catch {
        // ignore abort / transient lookup error
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [tickerInput, primarySymbol, secondarySymbol]);

  const loadComparisonStock = useCallback(
    async (rawSym: string) => {
      const sym = rawSym.trim().toUpperCase();
      if (!sym) return;
      if (sym === primarySymbol) {
        setError(`Choose a different NSE symbol than ${primarySymbol} to compare.`);
        return;
      }

      setLoading(true);
      setError(null);
      setShowSuggestions(false);
      setHoverIdx(null);

      try {
        const res = await fetch(`/api/stock/${encodeURIComponent(sym)}`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || `Symbol ${sym} not found (HTTP ${res.status})`);
        }
        setSecondarySymbol(sym);
        setTickerInput(sym);
        setSecondaryData(json as StockDetailData);
      } catch (err) {
        setError((err as Error).message || `Failed to load comparison data for ${sym}.`);
      } finally {
        setLoading(false);
      }
    },
    [primarySymbol]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadComparisonStock(tickerInput);
  };

  // Align overlapping / recent sessions chronologically by exact trading date
  const alignedPoints = useMemo<AlignedSessionPoint[]>(() => {
    if (!secondaryData) return [];
    const pHist = primaryData.history;
    const sHist = secondaryData.history;

    const pRvolMap = buildRvolSeries(pHist);
    const sRvolMap = buildRvolSeries(sHist);

    const pByDate = new Map(pHist.map((d) => [d.date, d]));
    const sByDate = new Map(sHist.map((d) => [d.date, d]));

    const allDates = Array.from(new Set([...pByDate.keys(), ...sByDate.keys()]))
      .sort()
      .slice(-35);

    // Base prices for normalized Base-100 performance line
    let pBase: number | null = null;
    let sBase: number | null = null;
    for (const dt of allDates) {
      const pc = pByDate.get(dt)?.close ?? null;
      const sc = sByDate.get(dt)?.close ?? null;
      if (pBase === null && pc !== null && pc > 0) pBase = pc;
      if (sBase === null && sc !== null && sc > 0) sBase = sc;
    }

    return allDates.map((dt) => {
      const pRow = pByDate.get(dt);
      const sRow = sByDate.get(dt);
      const pClose = pRow?.close ?? null;
      const sClose = sRow?.close ?? null;

      return {
        date: dt,
        primaryClose: pClose,
        secondaryClose: sClose,
        primaryNormPrice:
          pBase && pClose !== null ? Number(((pClose / pBase) * 100).toFixed(2)) : null,
        secondaryNormPrice:
          sBase && sClose !== null ? Number(((sClose / sBase) * 100).toFixed(2)) : null,
        primaryRvol: pRvolMap.get(dt) ?? null,
        secondaryRvol: sRvolMap.get(dt) ?? null,
        primaryDelivPer: pRow?.delivPer ?? null,
        secondaryDelivPer: sRow?.delivPer ?? null,
      };
    });
  }, [primaryData.history, secondaryData]);

  const metricsSummary = useMemo(() => {
    if (!secondaryData || alignedPoints.length === 0) return null;
    return {
      primaryAvgRvol: computeAvg(alignedPoints.map((p) => p.primaryRvol)),
      secondaryAvgRvol: computeAvg(alignedPoints.map((p) => p.secondaryRvol)),
      primaryAvgDeliv: computeAvg(alignedPoints.map((p) => p.primaryDelivPer)),
      secondaryAvgDeliv: computeAvg(alignedPoints.map((p) => p.secondaryDelivPer)),
      primaryHighDelivDays: alignedPoints.filter((p) => (p.primaryDelivPer ?? 0) >= 60).length,
      secondaryHighDelivDays: alignedPoints.filter((p) => (p.secondaryDelivPer ?? 0) >= 60).length,
      primaryPeriodRet: computePeriodReturnPct(alignedPoints.map((p) => p.primaryClose)),
      secondaryPeriodRet: computePeriodReturnPct(alignedPoints.map((p) => p.secondaryClose)),
    };
  }, [alignedPoints, secondaryData]);

  // Chart Geometry Calculations
  const chartGeom = useMemo(() => {
    if (alignedPoints.length === 0) return null;
    const width = 880;
    const padL = 54;
    const padR = 54;
    const plotW = width - padL - padR;
    const panelH = 156;
    const sliceW = plotW / Math.max(alignedPoints.length - 1, 1);

    const xFor = (i: number) =>
      alignedPoints.length <= 1 ? padL + plotW / 2 : padL + (i / (alignedPoints.length - 1)) * plotW;

    // 1. RVOL scale
    const rvolVals = alignedPoints
      .flatMap((p) => [p.primaryRvol, p.secondaryRvol])
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const maxRvol = Math.max(2.5, ...(rvolVals.length > 0 ? rvolVals : [2.0])) * 1.1;
    const minRvol = 0;
    const yRvolFor = (v: number) =>
      14 + (1 - (v - minRvol) / Math.max(maxRvol - minRvol, 0.1)) * (panelH - 28);

    // 2. Delivery % scale (0 - 100%)
    const yDelivFor = (v: number) =>
      14 + (1 - Math.min(100, Math.max(0, v)) / 100) * (panelH - 28);

    // 3. Normalized price scale (Base 100)
    const normVals = alignedPoints
      .flatMap((p) => [p.primaryNormPrice, p.secondaryNormPrice])
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const minNorm = Math.min(95, ...(normVals.length > 0 ? normVals : [100])) - 2;
    const maxNorm = Math.max(105, ...(normVals.length > 0 ? normVals : [100])) + 2;
    const yNormFor = (v: number) =>
      14 + (1 - (v - minNorm) / Math.max(maxNorm - minNorm, 1)) * (panelH - 28);

    return {
      width,
      padL,
      padR,
      plotW,
      panelH,
      sliceW,
      xFor,
      maxRvol,
      minRvol,
      yRvolFor,
      yDelivFor,
      minNorm,
      maxNorm,
      yNormFor,
      primaryRvolSegments: buildPolylineSegments(
        alignedPoints,
        (p) => p.primaryRvol,
        xFor,
        yRvolFor
      ),
      secondaryRvolSegments: buildPolylineSegments(
        alignedPoints,
        (p) => p.secondaryRvol,
        xFor,
        yRvolFor
      ),
      primaryDelivSegments: buildPolylineSegments(
        alignedPoints,
        (p) => p.primaryDelivPer,
        xFor,
        yDelivFor
      ),
      secondaryDelivSegments: buildPolylineSegments(
        alignedPoints,
        (p) => p.secondaryDelivPer,
        xFor,
        yDelivFor
      ),
      primaryNormSegments: buildPolylineSegments(
        alignedPoints,
        (p) => p.primaryNormPrice,
        xFor,
        yNormFor
      ),
      secondaryNormSegments: buildPolylineSegments(
        alignedPoints,
        (p) => p.secondaryNormPrice,
        xFor,
        yNormFor
      ),
    };
  }, [alignedPoints]);

  const activePoint =
    alignedPoints.length > 0
      ? alignedPoints[
          hoverIdx !== null && alignedPoints[hoverIdx] ? hoverIdx : alignedPoints.length - 1
        ]
      : null;

  const showRvolPanel = viewMode === 'BOTH' || viewMode === 'RVOL';
  const showDelivPanel = viewMode === 'BOTH' || viewMode === 'DELIVERY';
  const showNormPanel = viewMode === 'PRICE_NORM';

  const activePanelCount = (showRvolPanel ? 1 : 0) + (showDelivPanel ? 1 : 0) + (showNormPanel ? 1 : 0);
  const gapBetweenPanels = 24;
  const totalSvgHeight = chartGeom
    ? activePanelCount * chartGeom.panelH + Math.max(0, activePanelCount - 1) * gapBetweenPanels + 28
    : 220;

  const rvolOffset = 0;
  const delivOffset = showRvolPanel && chartGeom ? chartGeom.panelH + gapBetweenPanels : 0;
  const normOffset = 0;

  return (
    <section
      aria-label="Stock Comparison Mode"
      className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
    >
      {/* Panel Header + Secondary Ticker Input */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <GitCompareArrows className="w-4 h-4 text-blue-700 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900">
              Stock Comparison Mode
            </h3>
            <span className="text-xs font-mono text-slate-500">
              {primarySymbol}
              {secondaryData ? ` vs ${secondaryData.summary.symbol}` : ' · Select secondary ticker'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Side-by-side relative strength volume (RVOL) and delivery % trend comparison across aligned Bhavcopy sessions
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div ref={dropdownRef} className="relative">
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <div className="relative w-56 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={tickerInput}
                  onFocus={() => setShowSuggestions(true)}
                  onChange={(e) => {
                    setTickerInput(e.target.value);
                    setShowSuggestions(true);
                  }}
                  placeholder="Compare ticker (e.g. TCS, BEL)..."
                  aria-label="Secondary ticker symbol"
                  className="w-full min-h-[38px] pl-8 pr-3 py-1.5 text-xs font-mono uppercase bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !tickerInput.trim()}
                className="min-h-[38px] px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                {loading ? 'Loading...' : 'Compare'}
              </button>
            </form>

            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-0 right-16 mt-1 bg-white border border-slate-200 rounded-md shadow-lg z-30 max-h-56 overflow-y-auto divide-y divide-slate-100">
                {suggestions.map((item) => (
                  <button
                    key={item.symbol}
                    type="button"
                    onClick={() => void loadComparisonStock(item.symbol)}
                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-slate-900">
                        {item.symbol}
                      </span>
                      <span className="text-slate-500 ml-2 truncate">
                        {item.providerSector || 'Mainboard'}
                      </span>
                    </div>
                    <span className="font-mono text-slate-700 tabular-nums shrink-0">
                      ₹{item.closePrice.toFixed(1)} ·{' '}
                      {item.delivPer !== null ? `${item.delivPer.toFixed(0)}%` : '—'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {secondaryData && (
            <button
              type="button"
              onClick={() => onSelectSymbol(secondaryData.summary.symbol)}
              title={`Switch main view to ${secondaryData.summary.symbol}`}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Open {secondaryData.summary.symbol}
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close comparison mode"
              className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          )}
        </div>
      </div>

      {/* Quick Peer Suggestions */}
      {suggestedPeers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500 font-medium">Quick Compare Peers:</span>
          {suggestedPeers.map((peer) => {
            const isSelected = secondarySymbol === peer;
            return (
              <button
                key={peer}
                type="button"
                onClick={() => void loadComparisonStock(peer)}
                className={`px-2.5 py-1 text-xs font-mono rounded-md border transition-colors whitespace-nowrap ${
                  isSelected
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {peer}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="px-3.5 py-2.5 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Empty State Prompt */}
      {!secondaryData && !loading && (
        <div className="bg-slate-50 border border-slate-200/80 rounded-md p-6 text-center space-y-2">
          <div className="text-xs font-semibold text-slate-800">
            Enter a secondary NSE ticker above or click a peer to launch side-by-side trend comparison
          </div>
          <p className="text-xs text-slate-500 max-w-xl mx-auto">
            Dual-line charts overlay {primarySymbol} against your chosen comparison stock across RVOL (Relative Strength Volume), Delivery %, and Base-100 Price Performance.
          </p>
        </div>
      )}

      {/* Populated Comparison Analysis */}
      {secondaryData && metricsSummary && chartGeom && activePoint && (
        <div className="space-y-4">
          {/* Side-by-Side Comparison Metrics Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-md">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                  <th className="py-2 px-3.5">Stock</th>
                  <th className="py-2 px-3 text-right">Close (1D)</th>
                  <th className="py-2 px-3 text-right">{alignedPoints.length}D Return</th>
                  <th className="py-2 px-3 text-right">Latest / Avg RVOL</th>
                  <th className="py-2 px-3 text-right">Latest / Avg Deliv %</th>
                  <th className="py-2 px-3 text-right">&ge;60% Deliv Days</th>
                  <th className="py-2 px-3 text-right">Tier · P/E · ROE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {/* Primary Row */}
                <tr className="bg-blue-50/30">
                  <td className="py-2.5 px-3.5 font-sans">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-3 h-0.5 bg-blue-600 shrink-0" />
                      <span className="font-mono font-bold text-slate-900">
                        {primaryData.summary.symbol}
                      </span>
                      <span className="text-[11px] text-slate-500">Primary</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-900">
                    ₹{primaryData.summary.closePrice.toFixed(2)}{' '}
                    <span
                      className={
                        (primaryData.summary.changePct ?? 0) >= 0
                          ? 'text-emerald-700'
                          : 'text-rose-700'
                      }
                    >
                      {primaryData.summary.changePct !== null
                        ? `(${primaryData.summary.changePct >= 0 ? '+' : ''}${primaryData.summary.changePct.toFixed(1)}%)`
                        : ''}
                    </span>
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-semibold ${
                      (metricsSummary.primaryPeriodRet ?? 0) >= 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {metricsSummary.primaryPeriodRet !== null
                      ? `${metricsSummary.primaryPeriodRet >= 0 ? '+' : ''}${metricsSummary.primaryPeriodRet.toFixed(1)}%`
                      : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-900">
                    {primaryData.summary.rvol !== null ? `${primaryData.summary.rvol.toFixed(2)}x` : '—'}{' '}
                    <span className="text-slate-500">
                      / {metricsSummary.primaryAvgRvol !== null ? `${metricsSummary.primaryAvgRvol.toFixed(2)}x` : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-900">
                    {primaryData.summary.delivPer !== null ? `${primaryData.summary.delivPer.toFixed(1)}%` : '—'}{' '}
                    <span className="text-slate-500">
                      / {metricsSummary.primaryAvgDeliv !== null ? `${metricsSummary.primaryAvgDeliv.toFixed(1)}%` : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-700">
                    {metricsSummary.primaryHighDelivDays}/{alignedPoints.length}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-700">
                    {primaryData.summary.swingTier.replace('TIER_', 'T').replace(/_.*$/, '')} ·{' '}
                    {primaryData.fundamentals?.trailingPE !== null &&
                    primaryData.fundamentals?.trailingPE !== undefined
                      ? `${primaryData.fundamentals.trailingPE.toFixed(1)}x`
                      : '—'}{' '}
                    ·{' '}
                    {primaryData.fundamentals?.roePct !== null &&
                    primaryData.fundamentals?.roePct !== undefined
                      ? `${primaryData.fundamentals.roePct.toFixed(1)}%`
                      : '—'}
                  </td>
                </tr>

                {/* Secondary Row */}
                <tr className="bg-orange-50/25">
                  <td className="py-2.5 px-3.5 font-sans">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-3 h-0.5 bg-orange-600 shrink-0" />
                      <span className="font-mono font-bold text-slate-900">
                        {secondaryData.summary.symbol}
                      </span>
                      <span className="text-[11px] text-slate-500">Compare</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-900">
                    ₹{secondaryData.summary.closePrice.toFixed(2)}{' '}
                    <span
                      className={
                        (secondaryData.summary.changePct ?? 0) >= 0
                          ? 'text-emerald-700'
                          : 'text-rose-700'
                      }
                    >
                      {secondaryData.summary.changePct !== null
                        ? `(${secondaryData.summary.changePct >= 0 ? '+' : ''}${secondaryData.summary.changePct.toFixed(1)}%)`
                        : ''}
                    </span>
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-semibold ${
                      (metricsSummary.secondaryPeriodRet ?? 0) >= 0
                        ? 'text-emerald-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {metricsSummary.secondaryPeriodRet !== null
                      ? `${metricsSummary.secondaryPeriodRet >= 0 ? '+' : ''}${metricsSummary.secondaryPeriodRet.toFixed(1)}%`
                      : '—'}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-900">
                    {secondaryData.summary.rvol !== null ? `${secondaryData.summary.rvol.toFixed(2)}x` : '—'}{' '}
                    <span className="text-slate-500">
                      / {metricsSummary.secondaryAvgRvol !== null ? `${metricsSummary.secondaryAvgRvol.toFixed(2)}x` : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-900">
                    {secondaryData.summary.delivPer !== null ? `${secondaryData.summary.delivPer.toFixed(1)}%` : '—'}{' '}
                    <span className="text-slate-500">
                      / {metricsSummary.secondaryAvgDeliv !== null ? `${metricsSummary.secondaryAvgDeliv.toFixed(1)}%` : '—'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-700">
                    {metricsSummary.secondaryHighDelivDays}/{alignedPoints.length}
                  </td>
                  <td className="py-2.5 px-3 text-right text-slate-700">
                    {secondaryData.summary.swingTier.replace('TIER_', 'T').replace(/_.*$/, '')} ·{' '}
                    {secondaryData.fundamentals?.trailingPE !== null &&
                    secondaryData.fundamentals?.trailingPE !== undefined
                      ? `${secondaryData.fundamentals.trailingPE.toFixed(1)}x`
                      : '—'}{' '}
                    ·{' '}
                    {secondaryData.fundamentals?.roePct !== null &&
                    secondaryData.fundamentals?.roePct !== undefined
                      ? `${secondaryData.fundamentals.roePct.toFixed(1)}%`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Chart Mode Switcher & Legend */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-md text-xs self-start">
              {(
                [
                  ['BOTH', 'RVOL + Delivery %'],
                  ['RVOL', 'RVOL Only'],
                  ['DELIVERY', 'Delivery % Only'],
                  ['PRICE_NORM', 'Price Perf (Base 100)'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setViewMode(key)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    viewMode === key
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
              <span className="inline-flex items-center gap-1.5 text-blue-700 font-semibold">
                <span className="inline-block w-4 h-0.5 bg-blue-600" />
                {primarySymbol}
              </span>
              <span className="inline-flex items-center gap-1.5 text-orange-700 font-semibold">
                <span className="inline-block w-4 h-0.5 bg-orange-600" />
                {secondaryData.summary.symbol}
              </span>
            </div>
          </div>

          {/* Synchronized Hover Readout Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200/80 rounded-md text-xs font-mono tabular-nums">
            <div className="flex flex-wrap items-center gap-3 text-slate-700">
              <span className="font-semibold text-slate-900">{activePoint.date}</span>
              <span className="text-blue-700">
                {primarySymbol}:{' '}
                {activePoint.primaryRvol !== null ? `${activePoint.primaryRvol.toFixed(2)}x` : '—'} RVOL ·{' '}
                {activePoint.primaryDelivPer !== null ? `${activePoint.primaryDelivPer.toFixed(1)}%` : '—'} Deliv ·{' '}
                {activePoint.primaryClose !== null ? `₹${activePoint.primaryClose.toFixed(1)}` : '—'}
              </span>
              <span className="text-orange-700">
                {secondaryData.summary.symbol}:{' '}
                {activePoint.secondaryRvol !== null ? `${activePoint.secondaryRvol.toFixed(2)}x` : '—'} RVOL ·{' '}
                {activePoint.secondaryDelivPer !== null ? `${activePoint.secondaryDelivPer.toFixed(1)}%` : '—'} Deliv ·{' '}
                {activePoint.secondaryClose !== null ? `₹${activePoint.secondaryClose.toFixed(1)}` : '—'}
              </span>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-slate-600">
              {activePoint.primaryRvol !== null && activePoint.secondaryRvol !== null && (
                <span>
                  Δ RVOL:{' '}
                  <strong
                    className={
                      activePoint.primaryRvol >= activePoint.secondaryRvol
                        ? 'text-blue-700'
                        : 'text-orange-700'
                    }
                  >
                    {activePoint.primaryRvol - activePoint.secondaryRvol >= 0 ? '+' : ''}
                    {(activePoint.primaryRvol - activePoint.secondaryRvol).toFixed(2)}x
                  </strong>
                </span>
              )}
              {activePoint.primaryDelivPer !== null && activePoint.secondaryDelivPer !== null && (
                <span>
                  Δ Deliv:{' '}
                  <strong
                    className={
                      activePoint.primaryDelivPer >= activePoint.secondaryDelivPer
                        ? 'text-blue-700'
                        : 'text-orange-700'
                    }
                  >
                    {activePoint.primaryDelivPer - activePoint.secondaryDelivPer >= 0 ? '+' : ''}
                    {(activePoint.primaryDelivPer - activePoint.secondaryDelivPer).toFixed(1)}%
                  </strong>
                </span>
              )}
            </div>
          </div>

          {/* Dual-Line Comparative SVG Charts */}
          <div className="overflow-x-auto touch-pan-x">
            <svg
              viewBox={`0 0 ${chartGeom.width} ${totalSvgHeight}`}
              className="w-full min-w-[640px] h-auto select-none"
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* PANEL 1: RVOL Dual-Line Chart */}
              {showRvolPanel && (
                <g transform={`translate(0, ${rvolOffset})`}>
                  <text
                    x={chartGeom.padL}
                    y={10}
                    className="fill-slate-700 text-[10px] font-semibold uppercase tracking-wide"
                  >
                    Relative Strength Volume (RVOL)
                  </text>

                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                    const val = chartGeom.maxRvol * (1 - frac);
                    const y = chartGeom.yRvolFor(val);
                    return (
                      <g key={`rvol-g-${frac}`}>
                        <line
                          x1={chartGeom.padL}
                          x2={chartGeom.width - chartGeom.padR}
                          y1={y}
                          y2={y}
                          stroke="#E2E8F0"
                          strokeWidth="1"
                        />
                        <text
                          x={chartGeom.padL - 8}
                          y={y + 3}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono"
                        >
                          {val.toFixed(1)}x
                        </text>
                      </g>
                    );
                  })}

                  {/* 1.5x High RVOL reference threshold */}
                  <line
                    x1={chartGeom.padL}
                    x2={chartGeom.width - chartGeom.padR}
                    y1={chartGeom.yRvolFor(1.5)}
                    y2={chartGeom.yRvolFor(1.5)}
                    stroke="#64748B"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                  />
                  <text
                    x={chartGeom.width - chartGeom.padR + 6}
                    y={chartGeom.yRvolFor(1.5) + 3}
                    className="fill-slate-600 text-[10px] font-mono"
                  >
                    1.5x RVOL
                  </text>

                  {chartGeom.primaryRvolSegments.map((pts, i) => (
                    <polyline
                      key={`prvol-${i}`}
                      fill="none"
                      stroke="#2563EB"
                      strokeWidth="2.25"
                      strokeLinejoin="round"
                      points={pts}
                    />
                  ))}
                  {chartGeom.secondaryRvolSegments.map((pts, i) => (
                    <polyline
                      key={`srvol-${i}`}
                      fill="none"
                      stroke="#EA580C"
                      strokeWidth="2.25"
                      strokeLinejoin="round"
                      points={pts}
                    />
                  ))}

                  {hoverIdx !== null && alignedPoints[hoverIdx] && (
                    <>
                      {alignedPoints[hoverIdx].primaryRvol !== null && (
                        <circle
                          cx={chartGeom.xFor(hoverIdx)}
                          cy={chartGeom.yRvolFor(alignedPoints[hoverIdx].primaryRvol as number)}
                          r="4"
                          fill="#2563EB"
                          stroke="#FFFFFF"
                          strokeWidth="1.5"
                        />
                      )}
                      {alignedPoints[hoverIdx].secondaryRvol !== null && (
                        <circle
                          cx={chartGeom.xFor(hoverIdx)}
                          cy={chartGeom.yRvolFor(alignedPoints[hoverIdx].secondaryRvol as number)}
                          r="4"
                          fill="#EA580C"
                          stroke="#FFFFFF"
                          strokeWidth="1.5"
                        />
                      )}
                    </>
                  )}
                </g>
              )}

              {/* PANEL 2: Delivery % Dual-Line Chart */}
              {showDelivPanel && (
                <g transform={`translate(0, ${delivOffset})`}>
                  <text
                    x={chartGeom.padL}
                    y={10}
                    className="fill-slate-700 text-[10px] font-semibold uppercase tracking-wide"
                  >
                    Delivery Percentage Trend (%)
                  </text>

                  {[100, 75, 50, 25, 0].map((val) => {
                    const y = chartGeom.yDelivFor(val);
                    return (
                      <g key={`del-g-${val}`}>
                        <line
                          x1={chartGeom.padL}
                          x2={chartGeom.width - chartGeom.padR}
                          y1={y}
                          y2={y}
                          stroke="#E2E8F0"
                          strokeWidth="1"
                        />
                        <text
                          x={chartGeom.padL - 8}
                          y={y + 3}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono"
                        >
                          {val}%
                        </text>
                      </g>
                    );
                  })}

                  {/* 60% Institutional Delivery threshold */}
                  <line
                    x1={chartGeom.padL}
                    x2={chartGeom.width - chartGeom.padR}
                    y1={chartGeom.yDelivFor(60)}
                    y2={chartGeom.yDelivFor(60)}
                    stroke="#16A34A"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                  />
                  <text
                    x={chartGeom.width - chartGeom.padR + 6}
                    y={chartGeom.yDelivFor(60) + 3}
                    className="fill-emerald-700 text-[10px] font-mono"
                  >
                    60% Deliv
                  </text>

                  {chartGeom.primaryDelivSegments.map((pts, i) => (
                    <polyline
                      key={`pdel-${i}`}
                      fill="none"
                      stroke="#2563EB"
                      strokeWidth="2.25"
                      strokeLinejoin="round"
                      points={pts}
                    />
                  ))}
                  {chartGeom.secondaryDelivSegments.map((pts, i) => (
                    <polyline
                      key={`sdel-${i}`}
                      fill="none"
                      stroke="#EA580C"
                      strokeWidth="2.25"
                      strokeLinejoin="round"
                      points={pts}
                    />
                  ))}

                  {hoverIdx !== null && alignedPoints[hoverIdx] && (
                    <>
                      {alignedPoints[hoverIdx].primaryDelivPer !== null && (
                        <circle
                          cx={chartGeom.xFor(hoverIdx)}
                          cy={chartGeom.yDelivFor(alignedPoints[hoverIdx].primaryDelivPer as number)}
                          r="4"
                          fill="#2563EB"
                          stroke="#FFFFFF"
                          strokeWidth="1.5"
                        />
                      )}
                      {alignedPoints[hoverIdx].secondaryDelivPer !== null && (
                        <circle
                          cx={chartGeom.xFor(hoverIdx)}
                          cy={chartGeom.yDelivFor(alignedPoints[hoverIdx].secondaryDelivPer as number)}
                          r="4"
                          fill="#EA580C"
                          stroke="#FFFFFF"
                          strokeWidth="1.5"
                        />
                      )}
                    </>
                  )}
                </g>
              )}

              {/* PANEL 3: Normalized Price Performance (Base = 100) */}
              {showNormPanel && (
                <g transform={`translate(0, ${normOffset})`}>
                  <text
                    x={chartGeom.padL}
                    y={10}
                    className="fill-slate-700 text-[10px] font-semibold uppercase tracking-wide"
                  >
                    Normalized Price Performance (Start = 100)
                  </text>

                  {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                    const val =
                      chartGeom.maxNorm - frac * (chartGeom.maxNorm - chartGeom.minNorm);
                    const y = chartGeom.yNormFor(val);
                    return (
                      <g key={`norm-g-${frac}`}>
                        <line
                          x1={chartGeom.padL}
                          x2={chartGeom.width - chartGeom.padR}
                          y1={y}
                          y2={y}
                          stroke="#E2E8F0"
                          strokeWidth="1"
                        />
                        <text
                          x={chartGeom.padL - 8}
                          y={y + 3}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono"
                        >
                          {val.toFixed(0)}
                        </text>
                      </g>
                    );
                  })}

                  <line
                    x1={chartGeom.padL}
                    x2={chartGeom.width - chartGeom.padR}
                    y1={chartGeom.yNormFor(100)}
                    y2={chartGeom.yNormFor(100)}
                    stroke="#94A3B8"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                  />
                  <text
                    x={chartGeom.width - chartGeom.padR + 6}
                    y={chartGeom.yNormFor(100) + 3}
                    className="fill-slate-500 text-[10px] font-mono"
                  >
                    Base 100
                  </text>

                  {chartGeom.primaryNormSegments.map((pts, i) => (
                    <polyline
                      key={`pnorm-${i}`}
                      fill="none"
                      stroke="#2563EB"
                      strokeWidth="2.25"
                      strokeLinejoin="round"
                      points={pts}
                    />
                  ))}
                  {chartGeom.secondaryNormSegments.map((pts, i) => (
                    <polyline
                      key={`snorm-${i}`}
                      fill="none"
                      stroke="#EA580C"
                      strokeWidth="2.25"
                      strokeLinejoin="round"
                      points={pts}
                    />
                  ))}

                  {hoverIdx !== null && alignedPoints[hoverIdx] && (
                    <>
                      {alignedPoints[hoverIdx].primaryNormPrice !== null && (
                        <circle
                          cx={chartGeom.xFor(hoverIdx)}
                          cy={chartGeom.yNormFor(alignedPoints[hoverIdx].primaryNormPrice as number)}
                          r="4"
                          fill="#2563EB"
                          stroke="#FFFFFF"
                          strokeWidth="1.5"
                        />
                      )}
                      {alignedPoints[hoverIdx].secondaryNormPrice !== null && (
                        <circle
                          cx={chartGeom.xFor(hoverIdx)}
                          cy={chartGeom.yNormFor(alignedPoints[hoverIdx].secondaryNormPrice as number)}
                          r="4"
                          fill="#EA580C"
                          stroke="#FFFFFF"
                          strokeWidth="1.5"
                        />
                      )}
                    </>
                  )}
                </g>
              )}

              {/* Shared Vertical Crosshair */}
              {hoverIdx !== null && alignedPoints[hoverIdx] && (
                <line
                  x1={chartGeom.xFor(hoverIdx)}
                  x2={chartGeom.xFor(hoverIdx)}
                  y1={12}
                  y2={totalSvgHeight - 24}
                  stroke="#94A3B8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              )}

              {/* Shared Interactive Hover Columns */}
              {alignedPoints.map((pt, i) => (
                <rect
                  key={`cmp-hit-${pt.date}`}
                  x={chartGeom.xFor(i) - chartGeom.sliceW / 2}
                  y={10}
                  width={chartGeom.sliceW}
                  height={totalSvgHeight - 32}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(i)}
                />
              ))}

              {/* Shared X-Axis Date Labels */}
              {[0, Math.floor(alignedPoints.length / 2), alignedPoints.length - 1].map((idx) => {
                const pt = alignedPoints[idx];
                if (!pt) return null;
                return (
                  <text
                    key={`cmp-x-${idx}`}
                    x={chartGeom.xFor(idx)}
                    y={totalSvgHeight - 6}
                    textAnchor="middle"
                    className="fill-slate-400 text-[10px] font-mono"
                  >
                    {pt.date}
                  </text>
                );
              })}
            </svg>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5 text-blue-700 font-medium">
                <TrendingUp className="w-3.5 h-3.5" />
                {primarySymbol} (Solid Cobalt)
              </span>
              <span className="inline-flex items-center gap-1.5 text-orange-700 font-medium">
                <TrendingUp className="w-3.5 h-3.5" />
                {secondaryData.summary.symbol} (Solid Amber-Orange)
              </span>
            </div>
            <span className="font-mono">
              Aligned across {alignedPoints.length} Bhavcopy sessions · RVOL 1.5x &amp; Deliv 60% thresholds marked
            </span>
          </div>
        </div>
      )}
    </section>
  );
};
