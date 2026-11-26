import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bell,
  Bot,
  Calculator,
  CalendarClock,
  ChevronDown,
  Filter,
  History,
  Home,
  Layers,
  Menu,
  Minus,
  RefreshCw,
  Star,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { OverviewView } from './components/OverviewView';
import { ScreenerView } from './components/ScreenerView';
import { IpoSentimentView } from './components/IpoSentimentView';
import { CatalystGateView } from './components/CatalystGateView';
import { StockDetailView } from './components/StockDetailView';
import { SignalsView } from './components/SignalsView';
import { RiskCalculatorView } from './components/RiskCalculatorView';
import { BotView } from './components/BotView';
import { PaperTradingPanel } from './components/PaperTradingPanel';
import { RecommendedPicksPanel } from './components/RecommendedPicksPanel';
import { PriceAlertToastContainer } from './components/PriceAlertToastContainer';
import { syncAndLoadPaperPortfolio } from './utils/paperTradeClient';
import { evaluatePriceAlerts } from './utils/priceAlerts';
import { ErrorBoundary } from './components/ErrorBoundary';
import type {
  FundamentalFreshness,
  OverviewData,
  ScreenerFilterPatch,
  SignalLogEntry,
  StockDetailData,
  WatchlistResponse,
} from './types/trading';

type TabKey = 'overview' | 'bot' | 'paper' | 'screener' | 'ipo' | 'catalysts' | 'stock' | 'signals' | 'risk';
type BotScopeKey = 'LIQUID_TIERS' | 'TOP_SECTORS' | 'DELIV_HIGH' | 'WATCHLIST' | 'IPO';

interface NavRouteEntry {
  tab: TabKey;
  symbol: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [paperTabSeq, setPaperTabSeq] = useState(0);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('360ONE');
  const [navHistory, setNavHistory] = useState<NavRouteEntry[]>([
    { tab: 'overview', symbol: '360ONE' },
  ]);
  const [navIndex, setNavIndex] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [riskPrefill, setRiskPrefill] = useState<{
    symbol: string;
    entryPrice: number;
    stopLoss: number;
    targetPrice?: number | null;
  } | null>(null);
  const [screenerSector, setScreenerSector] = useState<string>('ALL');
  const [sectorResetSeq, setSectorResetSeq] = useState(0);
  const [screenerFreshness, setScreenerFreshness] = useState<FundamentalFreshness | 'ALL'>('ALL');
  const [freshnessResetSeq, setFreshnessResetSeq] = useState(0);
  const [screenerPreset, setScreenerPreset] = useState<{
    seq: number;
    patch: ScreenerFilterPatch;
  } | null>(null);
  const [botScopePreset, setBotScopePreset] = useState<{
    seq: number;
    scope: BotScopeKey;
  } | null>(null);
  const [sentimentOpen, setSentimentOpen] = useState(false);
  const sentimentRef = useRef<HTMLDivElement | null>(null);

  // Starred Watchlist & U-Turn Entry Trigger notification state
  const [watchlistData, setWatchlistData] = useState<WatchlistResponse>({
    symbols: [],
    items: [],
    triggered: [],
    triggeredCount: 0,
  });
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const watchlistRef = useRef<HTMLDivElement | null>(null);
  const watchlistSet = useMemo(
    () => new Set(watchlistData.symbols),
    [watchlistData.symbols]
  );

  // Periodic background monitor state for selectedSymbol stale/unverified auto save-to-cache
  const [stockRefreshSeq, setStockRefreshSeq] = useState(0);
  const [cacheSyncNotice, setCacheSyncNotice] = useState<string | null>(null);
  const syncInFlightRef = useRef<boolean>(false);
  const lastSyncAttemptRef = useRef<Map<string, number>>(new Map());

  // 1-click Full Scanner Reload state
  const [scannerReloading, setScannerReloading] = useState(false);
  const [scannerReloadSeq, setScannerReloadSeq] = useState(0);
  const [scannerNotice, setScannerNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sentimentRef.current && !sentimentRef.current.contains(e.target as Node)) {
        setSentimentOpen(false);
      }
      if (watchlistRef.current && !watchlistRef.current.contains(e.target as Node)) {
        setWatchlistOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSentimentOpen(false);
        setWatchlistOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const fetchOverview = async (isInitial = false) => {
    if (isInitial) setOverviewLoading(true);
    setOverviewError(null);
    try {
      const res = await fetch('/api/overview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: OverviewData = await res.json();
      setOverview(json);
      const priceSnapshot: Record<string, number> = {};
      for (const row of json.topDeliveryMovers || []) {
        if (row.symbol && typeof row.closePrice === 'number' && row.closePrice > 0) {
          priceSnapshot[row.symbol] = row.closePrice;
        }
      }
      evaluatePriceAlerts(priceSnapshot);
      if (isInitial && json.topDeliveryMovers?.[0]?.symbol) {
        setSelectedSymbol(json.topDeliveryMovers[0].symbol);
      }
    } catch (err) {
      setOverviewError((err as Error).message || 'Failed to load pipeline overview');
    } finally {
      if (isInitial) setOverviewLoading(false);
    }
  };

  const fetchWatchlist = async () => {
    try {
      const res = await fetch('/api/watchlist');
      if (!res.ok) return;
      const json: WatchlistResponse = await res.json();
      setWatchlistData(json);
    } catch {
      // ignore transient network errors
    }
  };

  const handleToggleWatchlist = async (sym: string) => {
    const cleaned = sym.trim().toUpperCase();
    if (!cleaned) return;
    try {
      const res = await fetch('/api/watchlist/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: cleaned }),
      });
      if (!res.ok) return;
      const json: WatchlistResponse = await res.json();
      setWatchlistData({
        symbols: json.symbols || [],
        items: json.items || [],
        triggered: json.triggered || [],
        triggeredCount: json.triggeredCount || 0,
      });
    } catch {
      // ignore transient error
    }
  };

  useEffect(() => {
    fetchOverview(true);
    void fetchWatchlist();
    void syncAndLoadPaperPortfolio({ live: false }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (scannerReloadSeq > 0 || stockRefreshSeq > 0) {
      void fetchWatchlist();
    }
  }, [scannerReloadSeq, stockRefreshSeq]);

  const handleReloadFullScanner = async () => {
    if (scannerReloading) return;
    setScannerReloading(true);
    setScannerNotice(null);
    try {
      const res = await fetch('/api/scanner/reload-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        reloaded?: boolean;
        latestSessionDate?: string;
        downloadedDates?: string[];
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await fetchOverview(false);
      setScannerReloadSeq((n) => n + 1);
      setStockRefreshSeq((n) => n + 1);
      setScannerNotice({
        tone: 'ok',
        text: json.message || `Scanner reloaded through EOD ${json.latestSessionDate || ''}.`,
      });
    } catch (err) {
      setScannerNotice({
        tone: 'err',
        text: `Full scanner reload failed: ${(err as Error).message}`,
      });
    } finally {
      setScannerReloading(false);
    }
  };

  const handleGlobalRetry = async () => {
    setOverviewError(null);
    setScannerNotice(null);
    setCacheSyncNotice(null);
    syncInFlightRef.current = false;
    lastSyncAttemptRef.current.clear();

    setScreenerSector('ALL');
    setScreenerFreshness('ALL');

    setScannerReloadSeq((n) => n + 1);
    setStockRefreshSeq((n) => n + 1);
    setPaperTabSeq((n) => n + 1);

    await Promise.all([fetchOverview(true), fetchWatchlist()]);
  };

  // Periodic background monitor: checks selectedSymbol fundamental state & triggers save-to-cache when stale or unverified
  useEffect(() => {
    if (!selectedSymbol) return;
    let cancelled = false;

    const verifyAndAutoCacheSelectedSymbol = async () => {
      const sym = selectedSymbol.trim().toUpperCase();
      if (!sym || syncInFlightRef.current) return;

      const lastTry = lastSyncAttemptRef.current.get(sym) ?? 0;
      if (Date.now() - lastTry < 5 * 60 * 1000) return;

      try {
        const res = await fetch(`/api/stock/${encodeURIComponent(sym)}`);
        if (!res.ok || cancelled) return;
        const detail = (await res.json()) as StockDetailData;

        const auditTier = detail.fundamentalAuditRows?.[0]?.freshnessTier;
        const freshness = detail.summary?.fundamentalFreshness;
        const isStaleOrUnverified =
          auditTier === 'UNVERIFIED' ||
          auditTier === 'OVER_3M' ||
          freshness === 'NOT_AVAILABLE' ||
          freshness === 'STALE';

        if (!isStaleOrUnverified || cancelled) return;

        syncInFlightRef.current = true;
        lastSyncAttemptRef.current.set(sym, Date.now());
        setCacheSyncNotice(`Auto-saving ${sym} fundamentals...`);

        const saveRes = await fetch('/api/fundamentals/save-to-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol: sym }),
        });

        if (saveRes.ok && !cancelled) {
          const saveJson = (await saveRes.json()) as { saved?: boolean; totalSavedCount?: number };
          if (saveJson.saved) {
            setStockRefreshSeq((n) => n + 1);
            setCacheSyncNotice(`Cached ${sym} (${saveJson.totalSavedCount ?? ''} total)`);
            void fetchOverview(false);
            window.setTimeout(() => {
              if (!cancelled) setCacheSyncNotice(null);
            }, 6000);
          } else {
            setCacheSyncNotice(null);
          }
        }
      } catch {
        // Ignore transient network errors during background monitor tick
      } finally {
        syncInFlightRef.current = false;
      }
    };

    const initialTimer = window.setTimeout(() => {
      void verifyAndAutoCacheSelectedSymbol();
    }, 1200);

    const intervalId = window.setInterval(() => {
      void verifyAndAutoCacheSelectedSymbol();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [selectedSymbol]);

  const navigateTo = (nextTab: TabKey, nextSymbol?: string) => {
    const cleanedSymbol = nextSymbol ? nextSymbol.toUpperCase() : selectedSymbol;
    if (nextSymbol) {
      setSelectedSymbol(cleanedSymbol);
    }
    setActiveTab(nextTab);
    setMobileMenuOpen(false);

    setNavHistory((prev) => {
      const sliced = prev.slice(0, navIndex + 1);
      const current = sliced[sliced.length - 1];
      if (current && current.tab === nextTab && current.symbol === cleanedSymbol) {
        return sliced;
      }
      const next = [...sliced, { tab: nextTab, symbol: cleanedSymbol }].slice(-40);
      setNavIndex(next.length - 1);
      return next;
    });
  };

  const handleGoBack = () => {
    if (navIndex <= 0) return;
    const targetIdx = navIndex - 1;
    const target = navHistory[targetIdx];
    if (!target) return;
    setNavIndex(targetIdx);
    setSelectedSymbol(target.symbol);
    setActiveTab(target.tab);
    setMobileMenuOpen(false);
  };

  const handleGoHome = () => {
    navigateTo('overview');
  };

  const openScreenerWithPreset = (patch: ScreenerFilterPatch) => {
    if (patch.sector !== undefined) {
      setScreenerSector(patch.sector);
    }
    if (patch.freshness !== undefined) {
      setScreenerFreshness(patch.freshness);
    }
    setScreenerPreset((prev) => ({
      seq: (prev?.seq ?? 0) + 1,
      patch,
    }));
    navigateTo('screener');
  };

  const openBotWithScope = (scope: BotScopeKey) => {
    setBotScopePreset((prev) => ({
      seq: (prev?.seq ?? 0) + 1,
      scope,
    }));
    navigateTo('bot');
  };

  const handleSelectSymbol = (symbol: string) => {
    navigateTo('stock', symbol.toUpperCase());
  };

  const handleSendSignalToRisk = (sig: SignalLogEntry) => {
    const entry = sig.entryZoneHigh ?? sig.closePrice ?? 0;
    const stop = sig.stopLoss ?? entry * 0.93;
    const targetMatch = sig.targetRiskReward.match(/^([\d.]+)/);
    const target = targetMatch ? Number(targetMatch[1]) : null;
    setRiskPrefill({
      symbol: sig.symbol,
      entryPrice: Number(entry.toFixed(2)),
      stopLoss: Number(stop.toFixed(2)),
      targetPrice: Number.isFinite(target) ? target : null,
    });
    navigateTo('risk');
  };

  const handleSendStockToRisk = (symbol: string, entryPrice: number, stopLoss: number) => {
    setRiskPrefill({
      symbol,
      entryPrice,
      stopLoss,
      targetPrice: Number((entryPrice * 1.15).toFixed(2)),
    });
    navigateTo('risk');
  };

  const navItems: Array<{ key: TabKey; label: string; icon: typeof Activity }> = [
    { key: 'overview', label: 'Pipeline Overview', icon: BarChart3 },
    { key: 'bot', label: 'Open-Source Bot (v3)', icon: Bot },
    { key: 'paper', label: 'Paper Trading & Picks', icon: Wallet },
    { key: 'screener', label: 'Delivery & RVOL Screener', icon: Filter },
    { key: 'ipo', label: 'IPO Sentiment & Analysis', icon: Layers },
    { key: 'catalysts', label: '3M Results & Catalyst Gate', icon: CalendarClock },
    { key: 'stock', label: 'Stock Deep-Dive & ECMS', icon: Activity },
    { key: 'signals', label: 'Signal History Log', icon: History },
    { key: 'risk', label: 'Risk & Position Sizer', icon: Calculator },
  ];

  const tabTitles: Record<TabKey, string> = {
    overview: 'Pipeline Overview',
    bot: 'Open-Source v3 Swing Trading Bot',
    paper: 'Paper Trading Journal, Strategy P&L & All-Filter Picks',
    screener: 'Delivery A/B & RVOL Screener',
    ipo: 'IPO Sentiment & Analysis (<1Y)',
    catalysts: '3M Results Priority & Rejection Gate',
    stock: `Stock Deep-Dive / ${selectedSymbol}`,
    signals: 'Signal History & Watchlist',
    risk: 'Portfolio Risk & Position Sizer',
  };

  const mobileShortTitles: Record<TabKey, string> = {
    overview: 'Overview',
    bot: 'v3 Swing Bot',
    paper: 'Paper & Picks',
    screener: 'Screener',
    ipo: 'IPO Analysis',
    catalysts: '3M Catalysts',
    stock: selectedSymbol,
    signals: 'Signals',
    risk: 'Risk Sizer',
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex overflow-x-clip">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-slate-200 shrink-0">
        <div className="h-14 px-5 flex items-center border-b border-slate-200">
          <span className="text-sm font-bold tracking-tight text-slate-900 whitespace-nowrap">
            NSE V8 &amp; ECMS Research
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => navigateTo(item.key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-md transition-colors text-left whitespace-nowrap ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-[11px] text-slate-500 space-y-1">
          <div className="font-medium text-slate-700">Research &amp; Shadow Only</div>
          <div>No automated broker orders</div>
          {overview && (
            <div className="font-mono pt-1 text-slate-400">
              Latest EOD: {overview.latestSessionDate}
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-50 w-72 max-w-[85vw] h-full bg-white border-r border-slate-200 flex flex-col overflow-y-auto">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200 shrink-0">
              <span className="text-sm font-bold text-slate-900">NSE V8 &amp; ECMS</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      navigateTo(item.key);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full min-h-[44px] flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium rounded-md text-left transition-colors ${
                      active
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-3 border-t border-slate-200 space-y-2.5 bg-slate-50/70">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  void handleReloadFullScanner();
                }}
                disabled={scannerReloading}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${scannerReloading ? 'animate-spin' : ''}`} />
                <span>{scannerReloading ? 'Reloading Scanner...' : 'Reload Full Scanner'}</span>
              </button>
              {overview && (
                <div className="text-[11px] font-mono text-slate-500 text-center">
                  Latest EOD: {overview.latestSessionDate} · Research Only
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: Compact mobile bar (48px), full desktop bar (56px) */}
        <header className="sticky top-0 z-30 h-12 lg:h-14 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 shrink-0">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-w-[38px] min-h-[38px] flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md shrink-0"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="inline-flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleGoBack}
                disabled={navIndex <= 0}
                title="Go Back"
                aria-label="Go Back"
                className="inline-flex items-center justify-center gap-1 min-w-[34px] min-h-[34px] sm:min-w-0 sm:min-h-0 px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:pointer-events-none border border-slate-200 rounded-md transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Back</span>
              </button>
              <button
                type="button"
                onClick={handleGoHome}
                disabled={activeTab === 'overview'}
                title="Go to Pipeline Overview Home"
                aria-label="Home"
                className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:pointer-events-none border border-slate-200 rounded-md transition-colors"
              >
                <Home className="w-3.5 h-3.5" />
                <span>Home</span>
              </button>
            </div>
            <div className="text-xs text-slate-500 truncate min-w-0">
              <span className="sm:hidden font-semibold text-slate-900 truncate">
                {mobileShortTitles[activeTab]}
              </span>
              <span className="hidden sm:inline">
                <button
                  type="button"
                  onClick={handleGoHome}
                  className="hover:text-slate-900 hover:underline transition-colors"
                >
                  NSE V8 &amp; ECMS
                </button>
                <span className="mx-2 text-slate-300">/</span>
                <span className="font-medium text-slate-900">{tabTitles[activeTab]}</span>
              </span>
              {cacheSyncNotice && (
                <span className="hidden md:inline">
                  <span className="mx-2 text-slate-300">·</span>
                  <span className="font-mono text-[11px] text-blue-700">{cacheSyncNotice}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {overview?.marketSentiment && (() => {
              const ms = overview.marketSentiment;
              const isBull = ms.status === 'BULLISH';
              const isBear = ms.status === 'BEARISH';
              const toneBox = isBull
                ? 'border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50 text-emerald-900'
                : isBear
                  ? 'border-rose-200 bg-rose-50/60 hover:bg-rose-50 text-rose-900'
                  : 'border-amber-200 bg-amber-50/60 hover:bg-amber-50 text-amber-900';
              const toneLabel = isBull
                ? 'text-emerald-700'
                : isBear
                  ? 'text-rose-700'
                  : 'text-amber-700';
              const barColor = isBull
                ? 'bg-emerald-600'
                : isBear
                  ? 'bg-rose-600'
                  : 'bg-amber-500';
              const StatusIcon = isBull ? TrendingUp : isBear ? TrendingDown : Minus;

              return (
                <div ref={sentimentRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setSentimentOpen((v) => !v)}
                    aria-expanded={sentimentOpen}
                    aria-label="Market Sentiment EOD breakdown"
                    className={`flex items-center gap-2 px-2.5 py-1.5 border rounded-md text-xs transition-colors whitespace-nowrap shrink-0 ${toneBox}`}
                  >
                    <StatusIcon className={`w-3.5 h-3.5 shrink-0 ${toneLabel}`} />
                    <span className="hidden md:inline text-[11px] font-medium text-slate-600">
                      Market Sentiment:
                    </span>
                    <span className={`font-semibold tracking-tight ${toneLabel}`}>
                      {ms.status}
                    </span>
                    <div
                      className="hidden sm:flex items-center gap-1.5 pl-1 border-l border-slate-200/80"
                      title={`EOD Score ${ms.score}/100`}
                    >
                      <div className="w-12 h-1.5 bg-slate-200/80 rounded-sm overflow-hidden">
                        <div
                          className={`h-full ${barColor} transition-all duration-300`}
                          style={{ width: `${ms.score}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] font-semibold text-slate-800">
                        {ms.score}
                      </span>
                    </div>
                    <span className="hidden xl:inline font-mono text-[11px] text-slate-500 pl-1 border-l border-slate-200/80">
                      Deliv {ms.deliveryAccumPct.toFixed(0)}%
                    </span>
                    <ChevronDown
                      className={`w-3 h-3 text-slate-400 transition-transform ${
                        sentimentOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {sentimentOpen && (
                    <div className="fixed inset-x-3 top-14 sm:inset-x-auto sm:top-auto sm:absolute sm:right-0 sm:mt-2 w-auto sm:w-96 max-h-[78vh] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-4 text-xs">
                      <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                        <div>
                          <div className="text-[11px] font-medium text-slate-500">
                            NSE Mainboard Market Sentiment
                          </div>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span className={`text-sm font-bold ${toneLabel}`}>{ms.status}</span>
                            <span className="font-mono text-xs font-semibold text-slate-800">
                              {ms.score}/100
                            </span>
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-slate-400">
                          EOD {ms.asOfDate}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2.5">
                        <div className="bg-slate-50 border border-slate-100 rounded-md p-2.5">
                          <div className="text-[11px] text-slate-500">Delivery Flow (&gt;=1.2x)</div>
                          <div className="mt-0.5 font-mono font-semibold text-slate-900">
                            {ms.deliveryExpandingUp} Up / {ms.deliveryExpandingDown} Down
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {ms.deliveryAccumPct.toFixed(1)}% accumulation
                          </div>
                        </div>

                        <div className="bg-slate-50 border border-slate-100 rounded-md p-2.5">
                          <div className="text-[11px] text-slate-500">High-RVOL (&gt;1.5x)</div>
                          <div className="mt-0.5 font-mono font-semibold text-slate-900">
                            {ms.highRvolUp} Up / {ms.highRvolDown} Down
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            Institutional participation
                          </div>
                        </div>

                        <div className="bg-slate-50 border border-slate-100 rounded-md p-2.5">
                          <div className="text-[11px] text-slate-500">EOD Breadth (A/D)</div>
                          <div className="mt-0.5 font-mono font-semibold text-slate-900">
                            {ms.advancers} / {ms.decliners}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {ms.breadthPct.toFixed(1)}% advancing
                          </div>
                        </div>

                        <div className="bg-slate-50 border border-slate-100 rounded-md p-2.5">
                          <div className="text-[11px] text-slate-500">Above EMA21 / EMA44</div>
                          <div className="mt-0.5 font-mono font-semibold text-slate-900">
                            {ms.aboveEma21Pct.toFixed(1)}% EMA21 · {(ms.aboveEma44Pct ?? 0).toFixed(1)}% EMA44
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {ms.ema21EligibleCount
                              ? `${ms.aboveEma21Count ?? 0}/${ms.ema21EligibleCount} eligible`
                              : `Avg Deliv ${ms.avgDeliveryPct.toFixed(1)}%`}{' '}
                            · A/B {ms.unionPct.toFixed(1)}%
                          </div>
                        </div>
                      </div>

                      <div className="mt-2.5 bg-emerald-50/50 border border-emerald-200 rounded-md p-2.5 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-[11px] font-medium text-emerald-900">
                            EMA 21 / EMA 44 Bullish Trend
                          </div>
                          <div className="font-mono text-[11px] text-emerald-700">
                            {ms.aboveEma21And44Pct !== undefined
                              ? `${ms.aboveEma21And44Pct.toFixed(1)}%${
                                  ms.ema21And44EligibleCount
                                    ? ` (${ms.aboveEma21And44Count ?? 0}/${ms.ema21And44EligibleCount})`
                                    : ''
                                } EMA21 > EMA44`
                              : 'EMA 21/44 Breadth'}{' '}
                            · {ms.emaCrossBullishCount ?? 0} fresh 5D crosses
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setSentimentOpen(false);
                              openScreenerWithPreset({
                                delivery: 'ALL',
                                liquidity: 'PASS',
                                emaCross: 'BULLISH_ALIGNED',
                                sort: 'rvol',
                                dir: 'desc',
                              });
                            }}
                            className="px-2 py-1 text-[10px] font-mono font-semibold bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded"
                          >
                            21&gt;44
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSentimentOpen(false);
                              openScreenerWithPreset({
                                delivery: 'ALL',
                                liquidity: 'ALL',
                                emaCross: 'RECENT_CROSS',
                                sort: 'rvol',
                                dir: 'desc',
                              });
                            }}
                            className="px-2 py-1 text-[10px] font-mono font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded"
                          >
                            5D Cross
                          </button>
                        </div>
                      </div>

                      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
                        {ms.summary}
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Watchlist & U-Turn Entry Trigger Notification Badge */}
            <div ref={watchlistRef} className="relative">
              <button
                type="button"
                onClick={() => setWatchlistOpen((v) => !v)}
                aria-expanded={watchlistOpen}
                aria-label={`Watchlist notifications: ${watchlistData.triggeredCount} U-Turn entry triggers`}
                className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 border rounded-md text-xs transition-colors whitespace-nowrap shrink-0 ${
                  watchlistData.triggeredCount > 0
                    ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100/70 text-emerald-900'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <Bell
                  className={`w-3.5 h-3.5 ${
                    watchlistData.triggeredCount > 0 ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                />
                <span className="hidden sm:inline font-medium">
                  Watchlist ({watchlistData.symbols.length})
                </span>
                {watchlistData.triggeredCount > 0 && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white bg-emerald-600 rounded-full tabular-nums"
                    title={`${watchlistData.triggeredCount} starred stock(s) meet U-Turn Entry Trigger criteria`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    {watchlistData.triggeredCount} U-Turn
                  </span>
                )}
              </button>

              {watchlistOpen && (
                <div className="fixed inset-x-3 top-14 sm:inset-x-auto sm:top-auto sm:absolute sm:right-0 sm:mt-2 w-auto sm:w-96 max-h-[78vh] overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl z-50 text-xs">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
                    <div>
                      <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                        Starred Watchlist &amp; U-Turn Alerts
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {watchlistData.triggeredCount > 0
                          ? `${watchlistData.triggeredCount} stock(s) meeting U-Turn Entry Trigger`
                          : 'No active U-Turn entry triggers among starred stocks'}
                      </div>
                    </div>
                  </div>

                  {watchlistData.triggered.length > 0 && (
                    <div className="p-3 bg-emerald-50/50 border-b border-emerald-100 space-y-1.5">
                      <div className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wide">
                        U-Turn Entry Triggers Met
                      </div>
                      {watchlistData.triggered.map((item) => (
                        <div
                          key={`trig-${item.symbol}`}
                          className="flex items-center justify-between gap-2 px-2.5 py-2 bg-white border border-emerald-200 rounded hover:border-emerald-400 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setWatchlistOpen(false);
                              handleSelectSymbol(item.symbol);
                            }}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="flex items-center gap-2 font-mono">
                              <span className="font-bold text-slate-900">{item.symbol}</span>
                              <span className="text-emerald-700 font-semibold">
                                {item.uTurnStatus === 'ACTIVE_TRIGGER'
                                  ? 'ACTIVE ENTRY TRIGGER'
                                  : 'CONFIRMED SUPPORT'}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-600 mt-0.5">
                              Close ₹{item.closePrice.toFixed(2)} · Target{' '}
                              {item.uTurnTarget !== null ? `₹${item.uTurnTarget.toFixed(2)}` : '—'} · Deliv{' '}
                              {item.delivPer !== null ? `${item.delivPer.toFixed(1)}%` : '—'} · RVOL{' '}
                              {item.rvol !== null ? `${item.rvol.toFixed(2)}x` : '—'}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleWatchlist(item.symbol)}
                            title="Remove from Watchlist"
                            className="p-1 text-amber-500 hover:text-slate-500 shrink-0"
                          >
                            <Star className="w-3.5 h-3.5 fill-amber-400" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                    {watchlistData.items.length === 0 ? (
                      <div className="p-4 text-slate-500">
                        Click the star icon next to any stock in the Screener or Deep-Dive view to monitor it for U-Turn Entry Triggers.
                      </div>
                    ) : (
                      watchlistData.items.map((item) => {
                        const isTrig =
                          item.uTurnStatus === 'ACTIVE_TRIGGER' ||
                          item.uTurnStatus === 'CONFIRMED_SUPPORT';
                        return (
                          <div
                            key={item.symbol}
                            className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setWatchlistOpen(false);
                                handleSelectSymbol(item.symbol);
                              }}
                              className="flex-1 text-left min-w-0"
                            >
                              <div className="flex items-center gap-2 font-mono">
                                <span className="font-semibold text-blue-700">{item.symbol}</span>
                                <span className="text-slate-700">₹{item.closePrice.toFixed(2)}</span>
                                <span
                                  className={`text-[11px] ${
                                    isTrig
                                      ? 'text-emerald-700 font-semibold'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  {item.uTurnStatus || 'MONITORING'}
                                </span>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleWatchlist(item.symbol)}
                              title="Unstar from Watchlist"
                              className="p-1 text-amber-500 hover:text-slate-500 shrink-0"
                            >
                              <Star className="w-3.5 h-3.5 fill-amber-400" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleReloadFullScanner}
              disabled={scannerReloading}
              title={
                overview
                  ? `Download missing NSE Bhavcopies, sync 30D deals & reload full scanner (Latest EOD: ${overview.latestSessionDate})`
                  : 'Download missing NSE Bhavcopies & reload full scanner'
              }
              aria-label="Reload Full Scanner"
              className="inline-flex items-center justify-center gap-1.5 min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 px-2 sm:px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${scannerReloading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{scannerReloading ? 'Reloading...' : 'Reload Scanner'}</span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('paper')}
              className={`hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'paper'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Wallet className="w-3.5 h-3.5 text-emerald-700" />
              <span>Paper &amp; Picks</span>
            </button>

            <button
              type="button"
              onClick={() => navigateTo('bot')}
              className={`hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'bot'
                  ? 'bg-emerald-700 text-white border-emerald-700'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              <span>v3 Swing Bot</span>
            </button>

            <button
              onClick={() => navigateTo('screener')}
              className="hidden lg:inline-flex px-3.5 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Screen Mainboard
            </button>
          </div>
        </header>

        <main className="flex-1 px-3 sm:px-6 pt-3 sm:pt-6 pb-20 lg:pb-6 max-w-[1440px] w-full mx-auto">
          <ErrorBoundary
            resetKeys={[activeTab, selectedSymbol]}
            contextLabel={tabTitles[activeTab]}
            externalError={
              activeTab === 'overview' && !overviewLoading && (overviewError || !overview)
                ? overviewError || 'Failed to load pipeline overview.'
                : null
            }
            onRetry={handleGlobalRetry}
            onNavigateHome={
              activeTab !== 'overview'
                ? () => {
                    setActiveTab('overview');
                    void handleGlobalRetry();
                  }
                : undefined
            }
          >
            {scannerNotice && (
              <div
                className={`mb-4 px-4 py-2.5 rounded-lg border text-xs flex items-center justify-between gap-3 ${
                  scannerNotice.tone === 'ok'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                <span className="font-mono leading-relaxed">{scannerNotice.text}</span>
                <button
                  type="button"
                  onClick={() => setScannerNotice(null)}
                  className="p-0.5 text-slate-500 hover:text-slate-900 shrink-0"
                  aria-label="Dismiss reload notice"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {activeTab === 'overview' && (
              <>
                {overviewLoading ? (
                  <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-xs text-slate-500">
                    Loading NSE Bhavcopy &amp; V8 pipeline metrics...
                  </div>
                ) : overview ? (
                  <OverviewView
                    data={overview}
                    onSelectSymbol={handleSelectSymbol}
                    onNavigate={(t) => navigateTo(t)}
                    onOpenScreener={openScreenerWithPreset}
                    onOpenBotIpo={() => openBotWithScope('IPO')}
                    onFilterBySector={(sector) => {
                      setScreenerSector(sector);
                      setSectorResetSeq((s) => s + 1);
                      navigateTo('screener');
                    }}
                    onFilterByFreshness={(f) => {
                      setScreenerFreshness(f);
                      setFreshnessResetSeq((s) => s + 1);
                      navigateTo('screener');
                    }}
                    onReloadOverview={() => fetchOverview(false)}
                  />
                ) : null}
              </>
            )}

            {activeTab === 'bot' && (
              <BotView
                onSelectSymbol={handleSelectSymbol}
                externalReloadSeq={scannerReloadSeq}
                externalScopePreset={botScopePreset}
              />
            )}

            {activeTab === 'paper' && (
              <div className="space-y-6">
                <RecommendedPicksPanel
                  onSelectSymbol={handleSelectSymbol}
                  onPaperBought={() => setPaperTabSeq((n) => n + 1)}
                />
                <PaperTradingPanel
                  onSelectSymbol={handleSelectSymbol}
                  externalSeq={paperTabSeq + scannerReloadSeq}
                />
              </div>
            )}

            {activeTab === 'screener' && (
              <ScreenerView
                onSelectSymbol={handleSelectSymbol}
                sector={screenerSector}
                onSectorChange={setScreenerSector}
                sectorResetSeq={sectorResetSeq}
                freshness={screenerFreshness}
                onFreshnessChange={setScreenerFreshness}
                freshnessResetSeq={freshnessResetSeq}
                screenerPreset={screenerPreset}
                availableSectors={(overview?.sectorSentiment || []).map((s) => s.sector)}
                topSectors={(overview?.sectorSentiment || []).slice(0, 3)}
                watchlistSymbols={watchlistSet}
                onToggleWatchlist={handleToggleWatchlist}
                externalReloadSeq={scannerReloadSeq}
              />
            )}

            {activeTab === 'ipo' && (
              <IpoSentimentView
                onSelectSymbol={handleSelectSymbol}
                onReloadOverview={() => fetchOverview(false)}
                externalReloadSeq={scannerReloadSeq}
              />
            )}

            {activeTab === 'catalysts' && (
              <CatalystGateView
                onSelectSymbol={handleSelectSymbol}
                externalReloadSeq={scannerReloadSeq}
              />
            )}

            {activeTab === 'stock' && (
              <StockDetailView
                symbol={selectedSymbol}
                onSelectSymbol={handleSelectSymbol}
                onSendToRisk={handleSendStockToRisk}
                isStarred={watchlistSet.has(selectedSymbol)}
                onToggleWatchlist={handleToggleWatchlist}
                externalRefreshSeq={stockRefreshSeq}
              />
            )}

            {activeTab === 'signals' && (
              <SignalsView
                onSelectSymbol={handleSelectSymbol}
                onSendToRisk={handleSendSignalToRisk}
                externalReloadSeq={scannerReloadSeq}
              />
            )}

            {activeTab === 'risk' && <RiskCalculatorView prefill={riskPrefill} />}
          </ErrorBoundary>
        </main>

        {/* Mobile Thumb-Zone Bottom Navigation Bar (5 core views, compact h-14) */}
        <nav
          aria-label="Mobile quick navigation"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="grid grid-cols-5 h-14 items-center">
            {(
              [
                { key: 'overview', label: 'Overview', icon: Home },
                { key: 'bot', label: 'Bot v3', icon: Bot },
                { key: 'paper', label: 'Paper', icon: Wallet },
                { key: 'screener', label: 'Screener', icon: Filter },
                {
                  key: 'stock',
                  label: selectedSymbol.length > 7 ? `${selectedSymbol.slice(0, 6)}…` : selectedSymbol,
                  icon: Activity,
                },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => navigateTo(item.key)}
                  className={`flex flex-col items-center justify-center min-h-[44px] h-full px-1 transition-colors ${
                    isActive
                      ? 'text-blue-700 font-semibold'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-[10px] tracking-tight mt-0.5 truncate max-w-full">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <PriceAlertToastContainer onSelectSymbol={handleSelectSymbol} />
      </div>
    </div>
  );
}
