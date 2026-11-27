import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type { AuditFreshnessTier, FundamentalAuditEntry, SwingTier } from '../types/trading';
import { authFetch } from '../utils/authClient';

interface FundamentalAuditTableProps {
  activeSymbol: string;
  activeSwingTier?: SwingTier;
  initialRows: FundamentalAuditEntry[];
  onSelectSymbol: (symbol: string) => void;
  onStockRefreshed: () => Promise<void>;
}

type AuditScope = 'PEERS' | 'UNIVERSE';
type AuditBasis = 'VERIFIED' | 'PERIOD';
type TierFilter =
  | 'ALL'
  | 'UNDER_1M'
  | 'ONE_TO_3M'
  | 'OVER_3M'
  | 'UNVERIFIED'
  | 'OVER_3M_OR_UNVERIFIED';
type ExchangeFilter = 'ALL' | 'BSE_VERIFIED' | 'NSE_XBRL';

interface AuditCounts {
  under1m: number;
  oneTo3m: number;
  over3m: number;
  unverified: number;
  nseMapped: number;
  bseMapped: number;
}

function classifyAge(ageDays: number | null): AuditFreshnessTier {
  if (ageDays === null) return 'UNVERIFIED';
  if (ageDays < 30) return 'UNDER_1M';
  if (ageDays <= 90) return 'ONE_TO_3M';
  return 'OVER_3M';
}

function formatUtcTimestamp(raw: string): string {
  if (!raw) return 'Never verified';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw} (Date only)`;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  const iso = new Date(parsed).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatFreshnessLabel(tier: AuditFreshnessTier): string {
  if (tier === 'UNDER_1M') return '< 1 Month';
  if (tier === 'ONE_TO_3M') return '1-3 Months';
  if (tier === 'OVER_3M') return '> 3 Months';
  return 'Unverified';
}

export const FundamentalAuditTable: React.FC<FundamentalAuditTableProps> = ({
  activeSymbol,
  activeSwingTier,
  initialRows,
  onSelectSymbol,
  onStockRefreshed,
}) => {
  const [scope, setScope] = useState<AuditScope>('PEERS');
  const [basis, setBasis] = useState<AuditBasis>('VERIFIED');
  const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const [universeRows, setUniverseRows] = useState<FundamentalAuditEntry[]>([]);
  const [universeTotal, setUniverseTotal] = useState(0);
  const [universeCounts, setUniverseCounts] = useState<AuditCounts | null>(null);
  const [universeLoading, setUniverseLoading] = useState(false);
  const [universeError, setUniverseError] = useState<string | null>(null);

  const [verifyingSymbol, setVerifyingSymbol] = useState<string | null>(null);
  const [savingAllCache, setSavingAllCache] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fetchUniverseAudit = useCallback(async () => {
    setUniverseLoading(true);
    setUniverseError(null);
    try {
      const qs = new URLSearchParams();
      if (searchQuery.trim()) qs.set('q', searchQuery.trim());
      if (tierFilter !== 'ALL') qs.set('tier', tierFilter);
      if (exchangeFilter !== 'ALL') qs.set('exchange', exchangeFilter);
      qs.set('basis', basis);
      qs.set('limit', String(limit));
      qs.set('offset', String(offset));

      const res = await fetch(`/api/fundamentals/audit?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setUniverseRows(json.rows || []);
      setUniverseTotal(json.total ?? 0);
      setUniverseCounts(json.counts || null);
    } catch (err) {
      setUniverseError((err as Error).message);
    } finally {
      setUniverseLoading(false);
    }
  }, [basis, exchangeFilter, offset, searchQuery, tierFilter]);

  useEffect(() => {
    setOffset(0);
  }, [activeSymbol, scope, basis, tierFilter, exchangeFilter, searchQuery]);

  useEffect(() => {
    if (scope === 'UNIVERSE') {
      void fetchUniverseAudit();
    }
  }, [scope, fetchUniverseAudit]);

  const getRowAgeAndTier = useCallback(
    (entry: FundamentalAuditEntry) => {
      const ageDays = basis === 'PERIOD' ? entry.periodAgeDays : entry.verifiedAgeDays;
      const tier = basis === 'PERIOD' ? classifyAge(ageDays) : entry.freshnessTier;
      return { ageDays, tier };
    },
    [basis]
  );

  const filteredPeers = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    return initialRows.filter((row) => {
      if (q) {
        const hit =
          row.symbol.includes(q) ||
          row.nseTicker.includes(q) ||
          row.bseTicker.includes(q) ||
          row.sector.toUpperCase().includes(q);
        if (!hit) return false;
      }
      if (exchangeFilter === 'BSE_VERIFIED' && !row.bseMapped) return false;
      if (exchangeFilter === 'NSE_XBRL' && row.nseXbrlCount === 0) return false;

      if (tierFilter !== 'ALL') {
        const { tier } = getRowAgeAndTier(row);
        if (tierFilter === 'OVER_3M_OR_UNVERIFIED') {
          if (tier !== 'OVER_3M' && tier !== 'UNVERIFIED') return false;
        } else if (tier !== tierFilter) {
          return false;
        }
      }
      return true;
    });
  }, [exchangeFilter, getRowAgeAndTier, initialRows, searchQuery, tierFilter]);

  const peerCounts = useMemo<AuditCounts>(() => {
    const c: AuditCounts = {
      under1m: 0,
      oneTo3m: 0,
      over3m: 0,
      unverified: 0,
      nseMapped: initialRows.length,
      bseMapped: 0,
    };
    for (const row of initialRows) {
      if (row.bseMapped) c.bseMapped += 1;
      const { tier } = getRowAgeAndTier(row);
      if (tier === 'UNDER_1M') c.under1m += 1;
      else if (tier === 'ONE_TO_3M') c.oneTo3m += 1;
      else if (tier === 'OVER_3M') c.over3m += 1;
      else c.unverified += 1;
    }
    return c;
  }, [getRowAgeAndTier, initialRows]);

  const displayedRows = scope === 'UNIVERSE' ? universeRows : filteredPeers;
  const activeCounts = scope === 'UNIVERSE' && universeCounts ? universeCounts : peerCounts;

  const handleSaveAllMissingToCache = async () => {
    setSavingAllCache(true);
    setActionNotice(null);
    try {
      const res = await authFetch('/api/fundamentals/save-to-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saveAll: true, scope: 'MISSING_OR_OLD' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setActionNotice(
        json.started
          ? `Saving ${json.total} missing/old Tier 1–3 symbols to cache automatically in background.`
          : json.message || 'All Tier 1–3 fundamentals are already saved to cache.'
      );
    } catch (err) {
      setActionNotice(`Save-to-cache error: ${(err as Error).message}`);
    } finally {
      setSavingAllCache(false);
    }
  };

  const handleVerifyBothExchanges = async (sym: string) => {
    setVerifyingSymbol(sym);
    setActionNotice(null);
    try {
      const res = await authFetch('/api/fundamentals/save-to-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym, force: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      if (!json.saved) {
        setActionNotice(`Verify failed for ${sym}: ${json.error || 'Unavailable'}`);
      } else {
        setActionNotice(
          `Saved & verified ${sym} across Screener.in, BSE Official & NSE XBRL · Total cached: ${json.totalSavedCount}.`
        );
        await onStockRefreshed();
        if (scope === 'UNIVERSE') {
          await fetchUniverseAudit();
        }
      }
    } catch (err) {
      setActionNotice(`Verify error for ${sym}: ${(err as Error).message}`);
    } finally {
      setVerifyingSymbol(null);
    }
  };

  const handleDownloadCsv = () => {
    if (displayedRows.length === 0) return;
    const headers = [
      'Symbol',
      'Series',
      'Sector',
      'NSE Ticker',
      'Screener.in / Primary Verified',
      'NSE XBRL Filings',
      'NSE Latest Filing Date',
      'BSE Ticker',
      'BSE Verified',
      'Last Update Timestamp (UTC)',
      'Financial Period End',
      basis === 'PERIOD' ? 'Statement Period Age (Days)' : 'Verified Age (Days)',
      'Freshness',
      'Coverage',
      'Fundamental Pass Count',
      'Sources',
    ];

    const lines = [headers.map(escapeCsvCell).join(',')];
    for (const entry of displayedRows) {
      const { ageDays, tier } = getRowAgeAndTier(entry);
      const hasPrimarySource =
        entry.sources.includes('Screener.in') || entry.sources.includes('YFinance (.NS)');
      const rowValues = [
        entry.symbol,
        entry.series,
        entry.sector,
        entry.nseTicker,
        hasPrimarySource ? 'Yes' : 'No',
        entry.nseXbrlCount,
        entry.nseLatestFilingDate,
        entry.bseTicker,
        entry.bseMapped ? 'Yes' : 'No',
        entry.lastUpdatedUtc,
        entry.financialPeriodEnd,
        ageDays,
        formatFreshnessLabel(tier),
        entry.coverage,
        entry.passCount,
        entry.sources.join(' | '),
      ];
      lines.push(rowValues.map(escapeCsvCell).join(','));
    }

    const csvContent = `\uFEFF${lines.join('\r\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const todayIso = new Date().toISOString().slice(0, 10);
    const scopeTag =
      scope === 'UNIVERSE' ? 'tier1_to_3_watchlist' : `${activeSymbol.toLowerCase()}_peers`;
    const filename = `fundamental_audit_${scopeTag}_${basis.toLowerCase()}_${todayIso}.csv`;

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    setActionNotice(
      `Downloaded ${displayedRows.length} row(s) from the current Fundamental Audit view (${filename}).`
    );
  };

  const renderFreshnessBadge = (tier: AuditFreshnessTier, ageDays: number | null) => {
    if (tier === 'UNDER_1M') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-emerald-50 text-emerald-800 border-emerald-200 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
          &lt; 1 Month{ageDays !== null ? ` · ${ageDays}d` : ''}
        </span>
      );
    }
    if (tier === 'ONE_TO_3M') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-amber-50 text-amber-800 border-amber-200 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          1–3 Months{ageDays !== null ? ` · ${ageDays}d` : ''}
        </span>
      );
    }
    if (tier === 'OVER_3M') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-rose-50 text-rose-800 border-rose-200 whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0" />
          &gt; 3 Months{ageDays !== null ? ` · ${ageDays}d` : ''}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border bg-rose-50 text-rose-800 border-rose-200 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0" />
        Unverified
      </span>
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Fundamental Audit — Exchange Mapping &amp; Freshness
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Maps symbols to Screener.in, NSE XBRL, and BSE Official records, last verified UTC timestamp,
            and freshness tier (Green &lt; 1M · Yellow 1–3M · Red &gt; 3M / Unverified).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Scope Switch */}
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setScope('PEERS')}
              className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                scope === 'PEERS'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Active &amp; Peers ({initialRows.length})
            </button>
            <button
              type="button"
              onClick={() => setScope('UNIVERSE')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                scope === 'UNIVERSE'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Database className="w-3 h-3" />
              Tier 1–3 Watchlist
            </button>
          </div>

          {/* Age Basis Toggle */}
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setBasis('VERIFIED')}
              className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                basis === 'VERIFIED'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Age measured since last fundamental verification timestamp"
            >
              By Verified Date
            </button>
            <button
              type="button"
              onClick={() => setBasis('PERIOD')}
              className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                basis === 'PERIOD'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Age measured since financial statement period end date"
            >
              By Statement Period
            </button>
          </div>

          <button
            type="button"
            onClick={handleSaveAllMissingToCache}
            disabled={savingAllCache}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-xs font-medium text-white whitespace-nowrap transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${savingAllCache ? 'animate-spin' : ''}`} />
            {savingAllCache ? 'Starting...' : 'Save Tier 1–3 to Cache'}
          </button>

          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={displayedRows.length === 0 || (scope === 'UNIVERSE' && universeLoading)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-xs font-medium text-slate-700 whitespace-nowrap transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            Download Audit Report
          </button>
        </div>
      </div>

      {/* Filters & Freshness Counters */}
      <div className="px-5 py-3 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setTierFilter('ALL')}
            className={`px-2.5 py-1 rounded border font-medium transition-colors whitespace-nowrap ${
              tierFilter === 'ALL'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            All <span className="font-mono tabular-nums ml-1">{activeCounts.nseMapped}</span>
          </button>
          <button
            type="button"
            onClick={() => setTierFilter('UNDER_1M')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-medium transition-colors whitespace-nowrap ${
              tierFilter === 'UNDER_1M'
                ? 'bg-emerald-700 text-white border-emerald-700'
                : 'bg-white text-emerald-800 border-emerald-200 hover:bg-emerald-50'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                tierFilter === 'UNDER_1M' ? 'bg-white' : 'bg-emerald-600'
              }`}
            />
            &lt; 1M Green{' '}
            <span className="font-mono tabular-nums">{activeCounts.under1m}</span>
          </button>
          <button
            type="button"
            onClick={() => setTierFilter('ONE_TO_3M')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-medium transition-colors whitespace-nowrap ${
              tierFilter === 'ONE_TO_3M'
                ? 'bg-amber-600 text-white border-amber-600'
                : 'bg-white text-amber-800 border-amber-200 hover:bg-amber-50'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                tierFilter === 'ONE_TO_3M' ? 'bg-white' : 'bg-amber-500'
              }`}
            />
            1–3M Yellow{' '}
            <span className="font-mono tabular-nums">{activeCounts.oneTo3m}</span>
          </button>
          <button
            type="button"
            onClick={() => setTierFilter('OVER_3M')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-medium transition-colors whitespace-nowrap ${
              tierFilter === 'OVER_3M'
                ? 'bg-rose-700 text-white border-rose-700'
                : 'bg-white text-rose-800 border-rose-200 hover:bg-rose-50'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                tierFilter === 'OVER_3M' ? 'bg-white' : 'bg-rose-600'
              }`}
            />
            &gt; 3M Red{' '}
            <span className="font-mono tabular-nums">{activeCounts.over3m}</span>
          </button>
          <button
            type="button"
            onClick={() => setTierFilter('UNVERIFIED')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-medium transition-colors whitespace-nowrap ${
              tierFilter === 'UNVERIFIED'
                ? 'bg-rose-800 text-white border-rose-800'
                : 'bg-white text-rose-800 border-rose-200 hover:bg-rose-50'
            }`}
          >
            Unverified{' '}
            <span className="font-mono tabular-nums">{activeCounts.unverified}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Exchange Filter"
            value={exchangeFilter}
            onChange={(e) => setExchangeFilter(e.target.value as ExchangeFilter)}
            className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md text-slate-700"
          >
            <option value="ALL">All Exchanges ({activeCounts.nseMapped})</option>
            <option value="BSE_VERIFIED">
              BSE (.BO) Verified ({activeCounts.bseMapped})
            </option>
            <option value="NSE_XBRL">NSE XBRL Filed Only</option>
          </select>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter symbol / sector..."
              className="pl-8 pr-2.5 py-1 text-xs bg-white border border-slate-200 rounded-md w-44 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {actionNotice && (
        <div className="px-5 py-2 bg-blue-50 border-b border-blue-200 text-xs text-blue-900 flex items-center justify-between gap-2">
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="text-blue-700 hover:text-blue-900 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {universeError && scope === 'UNIVERSE' && (
        <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">
          Audit load error: {universeError}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
              <th className="py-2.5 px-4">Symbol</th>
              <th className="py-2.5 px-3">NSE Exchange Data</th>
              <th className="py-2.5 px-3">BSE Exchange Data</th>
              <th className="py-2.5 px-3">Last Update Timestamp</th>
              <th className="py-2.5 px-3">Freshness</th>
              <th className="py-2.5 px-4 text-right">Verify</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {scope === 'UNIVERSE' && universeLoading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">
                  Loading NSE/BSE audit records...
                </td>
              </tr>
            ) : displayedRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">
                  No symbols match the selected Freshness or Exchange filter.
                </td>
              </tr>
            ) : (
              displayedRows.map((entry) => {
                const isActive = entry.symbol === activeSymbol;
                const isVerifying = verifyingSymbol === entry.symbol;
                const { ageDays, tier } = getRowAgeAndTier(entry);
                const hasScreener = entry.sources.includes('Screener.in');
                const hasLegacyYahoo = !hasScreener && entry.sources.includes('YFinance (.NS)');

                return (
                  <tr
                    key={entry.symbol}
                    className={
                      isActive ? 'bg-blue-50/40' : 'hover:bg-slate-50/80 transition-colors'
                    }
                  >
                    {/* Symbol */}
                    <td className="py-2.5 px-4 align-top">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(entry.symbol)}
                          className="font-mono font-semibold text-blue-700 hover:underline text-left"
                        >
                          {entry.symbol}
                        </button>
                        {isActive && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-800 rounded">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[180px]">
                        {entry.series}
                        {entry.sector ? ` · ${entry.sector}` : ''}
                      </div>
                    </td>

                    {/* NSE Exchange Data */}
                    <td className="py-2.5 px-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-medium text-slate-900">
                          {entry.nseTicker}
                        </span>
                        {hasScreener && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-mono">
                            Screener.in
                          </span>
                        )}
                        {hasLegacyYahoo && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-mono">
                            Legacy Cache
                          </span>
                        )}
                        {entry.nseXbrlCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-mono tabular-nums">
                            {entry.nseXbrlCount} XBRL
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                        {entry.nseLatestFilingDate
                          ? `Filing ${entry.nseLatestFilingDate}`
                          : entry.coverage !== 'MISSING'
                            ? `${entry.passCount}/7 gates`
                            : 'No XBRL filing cached'}
                      </div>
                    </td>

                    {/* BSE Exchange Data */}
                    <td className="py-2.5 px-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-medium text-slate-900">
                          {entry.bseTicker}
                        </span>
                        {entry.bseMapped ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-medium whitespace-nowrap">
                            BSE Verified
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Standby</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[180px]">
                        {entry.bseMapped
                          ? 'BSE Official active'
                          : 'Click Verify to probe Screener/BSE'}
                      </div>
                    </td>

                    {/* Last Update Timestamp */}
                    <td className="py-2.5 px-3 align-top">
                      <div className="font-mono tabular-nums text-slate-900 whitespace-nowrap">
                        {formatUtcTimestamp(entry.lastUpdatedUtc)}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                        {entry.financialPeriodEnd
                          ? `Period ${entry.financialPeriodEnd}`
                          : 'Period date unrecorded'}
                      </div>
                    </td>

                    {/* Freshness Badge */}
                    <td className="py-2.5 px-3 align-top">
                      {renderFreshnessBadge(tier, ageDays)}
                    </td>

                    {/* Action */}
                    <td className="py-2.5 px-4 text-right align-top">
                      {isActive && activeSwingTier === 'NONE' ? (
                        <span
                          title="Fundamental Deep Audit runs only on stocks selected into Tier 1, Tier 2, or Tier 3."
                          className="inline-flex items-center px-2 py-1 rounded border border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-400 whitespace-nowrap"
                        >
                          Tier 1–3 Only
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleVerifyBothExchanges(entry.symbol)}
                          disabled={verifyingSymbol !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-[11px] font-medium text-slate-700 whitespace-nowrap transition-colors"
                        >
                          <RefreshCw
                            className={`w-3 h-3 ${isVerifying ? 'animate-spin text-blue-600' : ''}`}
                          />
                          {isVerifying ? 'Verifying...' : 'Verify NSE/BSE'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer (All Mainboard Mode) */}
      {scope === 'UNIVERSE' && (
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <div className="font-mono tabular-nums">
            Showing {universeTotal === 0 ? 0 : offset + 1}–
            {Math.min(offset + limit, universeTotal)} of {universeTotal} matching stocks
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOffset((p) => Math.max(0, p - limit))}
              disabled={offset === 0 || universeLoading}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40 font-medium"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <button
              type="button"
              onClick={() => setOffset((p) => p + limit)}
              disabled={offset + limit >= universeTotal || universeLoading}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40 font-medium"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
