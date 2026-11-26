import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  BellRing,
  Calculator,
  Check,
  CheckCircle2,
  Clock,
  Radar,
  RotateCcw,
  Target,
  Trash2,
  TrendingUp,
  Volume2,
  VolumeX,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ScreenerRow,
  TurnaroundTopEvaluation,
  TurnaroundTopSessionCheck,
  TurnaroundTopStatus,
  UTurnEvaluation,
  UTurnSessionCheck,
  UTurnStatus,
} from '../types/trading';

export interface UTurnStrategyMonitorProps {
  symbol: string;
  latestDate: string;
  currentClose: number;
  detectedPeakPrice: number;
  detectedPeakDate: string;
  epsPrev: number | null;
  epsCurr: number | null;
  epsPrevPeriod?: string;
  epsCurrPeriod?: string;
  trailingPE: number | null;
  liveDeliveryPct: number | null;
  liveRvol: number | null;
  onSelectSymbol?: (symbol: string) => void;
  onSendToRisk?: (symbol: string, entryPrice: number, stopLoss: number) => void;
}

type AlertCondition = 'ZONE_ENTRY' | 'ZONE_WITH_TECH';

interface SupportZoneAlert {
  id: string;
  dedupKey: string;
  symbol: string;
  eodDate: string;
  triggeredAtIso: string;
  closePrice: number;
  uTurnTarget: number;
  zoneLow: number;
  zoneHigh: number;
  epsDrop: number | null;
  avgPeRatio: number | null;
  delivPer: number | null;
  rvol: number | null;
  basisLabel: string;
  condition: AlertCondition;
  acknowledged: boolean;
}

const ALERT_STORAGE_KEY = 'nse_v8_uturn_zone_alerts_v1';
const ALERT_PREFS_KEY = 'nse_v8_uturn_alert_prefs_v1';

const DELIVERY_THRESHOLD = 60;
const RVOL_THRESHOLD = 1.5;

const STATUS_STYLE: Record<
  UTurnStatus,
  { surface: string; text: string; labelCls: string }
> = {
  CONFIRMED_SUPPORT: {
    surface: 'bg-emerald-50/70 border-emerald-200',
    text: 'text-emerald-900',
    labelCls: 'text-emerald-700',
  },
  ACTIVE_TRIGGER: {
    surface: 'bg-blue-50/70 border-blue-200',
    text: 'text-blue-900',
    labelCls: 'text-blue-700',
  },
  SUPPORT_HOLD: {
    surface: 'bg-teal-50/70 border-teal-200',
    text: 'text-teal-900',
    labelCls: 'text-teal-700',
  },
  IN_ZONE: {
    surface: 'bg-amber-50/70 border-amber-200',
    text: 'text-amber-900',
    labelCls: 'text-amber-800',
  },
  BROKEN_DOWN: {
    surface: 'bg-rose-50/70 border-rose-200',
    text: 'text-rose-900',
    labelCls: 'text-rose-700',
  },
  ABOVE_ZONE: {
    surface: 'bg-slate-50 border-slate-200',
    text: 'text-slate-800',
    labelCls: 'text-slate-700',
  },
};

const TOP_STATUS_STYLE: Record<
  TurnaroundTopStatus,
  { surface: string; text: string; labelCls: string }
> = {
  CONFIRMED_TOP: {
    surface: 'bg-rose-50/70 border-rose-200',
    text: 'text-rose-900',
    labelCls: 'text-rose-700',
  },
  ACTIVE_TOP_TRIGGER: {
    surface: 'bg-amber-50/80 border-amber-200',
    text: 'text-amber-900',
    labelCls: 'text-amber-800',
  },
  TOP_ZONE_WATCH: {
    surface: 'bg-amber-50/50 border-amber-200',
    text: 'text-amber-900',
    labelCls: 'text-amber-700',
  },
  TOP_BREAKOUT: {
    surface: 'bg-emerald-50/70 border-emerald-200',
    text: 'text-emerald-900',
    labelCls: 'text-emerald-700',
  },
  BELOW_TOP_ZONE: {
    surface: 'bg-slate-50 border-slate-200',
    text: 'text-slate-800',
    labelCls: 'text-slate-700',
  },
};

function formatBottomAction(action: UTurnSessionCheck['action']): { label: string; cls: string } {
  switch (action) {
    case 'IN_ZONE_TRIGGER':
      return { label: 'Zone + Tech Trigger', cls: 'text-blue-700 font-semibold' };
    case 'BOUNCED_ABOVE':
      return { label: 'Bounced Above Zone', cls: 'text-emerald-700 font-semibold' };
    case 'HELD_SUPPORT':
      return { label: 'Held Support', cls: 'text-emerald-700 font-medium' };
    case 'BROKE_BELOW':
      return { label: 'Broke Zone Low', cls: 'text-rose-700 font-semibold' };
    case 'IN_ZONE':
    default:
      return { label: 'Inside Zone', cls: 'text-amber-700 font-medium' };
  }
}

function formatTopAction(action: TurnaroundTopSessionCheck['action']): {
  label: string;
  cls: string;
} {
  switch (action) {
    case 'TOP_TRIGGER':
      return { label: 'Exhaustion (High RVOL + Low Deliv)', cls: 'text-amber-800 font-semibold' };
    case 'TOP_REJECTION':
      return { label: 'Top Rejection / Distribution', cls: 'text-rose-700 font-semibold' };
    case 'TOP_BREAKOUT':
      return { label: 'Breakout (Deliv >= 50%)', cls: 'text-emerald-700 font-semibold' };
    case 'TOP_ZONE':
    default:
      return { label: 'In Top Zone', cls: 'text-amber-700 font-medium' };
  }
}

function playAlertChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {
    // Ignore blocked audio context
  }
}

function loadStoredAlerts(): SupportZoneAlert[] {
  try {
    const raw = localStorage.getItem(ALERT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadAlertPrefs(): {
  armed: boolean;
  condition: AlertCondition;
  soundEnabled: boolean;
  browserNotify: boolean;
} {
  try {
    const raw = localStorage.getItem(ALERT_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        armed: typeof p.armed === 'boolean' ? p.armed : true,
        condition: p.condition === 'ZONE_WITH_TECH' ? 'ZONE_WITH_TECH' : 'ZONE_ENTRY',
        soundEnabled: typeof p.soundEnabled === 'boolean' ? p.soundEnabled : false,
        browserNotify: typeof p.browserNotify === 'boolean' ? p.browserNotify : false,
      };
    }
  } catch {
    // fall through
  }
  return {
    armed: true,
    condition: 'ZONE_ENTRY',
    soundEnabled: false,
    browserNotify: false,
  };
}

export const UTurnStrategyMonitor: React.FC<UTurnStrategyMonitorProps> = ({
  symbol,
  latestDate,
  currentClose,
  detectedPeakPrice,
  detectedPeakDate,
  epsPrev,
  epsCurr,
  epsPrevPeriod,
  epsCurrPeriod,
  trailingPE,
  liveDeliveryPct,
  liveRvol,
  onSelectSymbol,
  onSendToRisk,
}) => {
  const [strategy, setStrategy] = useState<'BOTTOM' | 'TOP'>('BOTTOM');
  const [userPickedStrategy, setUserPickedStrategy] = useState(false);

  // Inputs initialized from current stock's props (with direct edit support)
  const [peakInput, setPeakInput] = useState<string>('');
  const [epsPrevInput, setEpsPrevInput] = useState<string>('');
  const [epsCurrInput, setEpsCurrInput] = useState<string>('');
  const [avgPeInput, setAvgPeInput] = useState<string>('');
  const [zoneTolerancePct, setZoneTolerancePct] = useState<2 | 3>(2);
  const [inputMode, setInputMode] = useState<'EPS_PE' | 'PCT'>('EPS_PE');
  const [pctDropInput, setPctDropInput] = useState<string>('10');

  // Automated Alert System State
  const initialPrefs = useMemo(() => loadAlertPrefs(), []);
  const [alertsArmed, setAlertsArmed] = useState<boolean>(initialPrefs.armed);
  const [alertCondition, setAlertCondition] = useState<AlertCondition>(initialPrefs.condition);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(initialPrefs.soundEnabled);
  const [browserNotify, setBrowserNotify] = useState<boolean>(initialPrefs.browserNotify);
  const [browserPerm, setBrowserPerm] = useState<string>(() =>
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [alertsLog, setAlertsLog] = useState<SupportZoneAlert[]>(() => loadStoredAlerts());
  const [activeToastAlert, setActiveToastAlert] = useState<SupportZoneAlert | null>(null);
  const [alertLogOpen, setAlertLogOpen] = useState<boolean>(false);
  const [scanningUniverse, setScanningUniverse] = useState<boolean>(false);
  const [scanSummary, setScanSummary] = useState<string | null>(null);

  const alertsLogRef = useRef<SupportZoneAlert[]>(alertsLog);
  useEffect(() => {
    alertsLogRef.current = alertsLog;
    try {
      localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alertsLog.slice(0, 50)));
    } catch {
      // ignore storage quota
    }
  }, [alertsLog]);

  useEffect(() => {
    try {
      localStorage.setItem(
        ALERT_PREFS_KEY,
        JSON.stringify({
          armed: alertsArmed,
          condition: alertCondition,
          soundEnabled,
          browserNotify,
        })
      );
    } catch {
      // ignore
    }
  }, [alertsArmed, alertCondition, soundEnabled, browserNotify]);

  // Backend subsequent-session & trajectory verification state
  const [evalData, setEvalData] = useState<UTurnEvaluation | null>(null);
  const [evalLoading, setEvalLoading] = useState<boolean>(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Turnaround Top inputs & state
  const [topEffEpsInput, setTopEffEpsInput] = useState<string>('');
  const [topPeakPeInput, setTopPeakPeInput] = useState<string>('');
  const [topData, setTopData] = useState<TurnaroundTopEvaluation | null>(null);
  const [topLoading, setTopLoading] = useState<boolean>(false);
  const [topError, setTopError] = useState<string | null>(null);

  // Reset overrides when symbol changes
  useEffect(() => {
    setStrategy('BOTTOM');
    setUserPickedStrategy(false);
    setPeakInput('');
    setEpsPrevInput('');
    setEpsCurrInput('');
    setAvgPeInput('');
    setPctDropInput('10');
    setInputMode('EPS_PE');
    setTopEffEpsInput('');
    setTopPeakPeInput('');
    setTopData(null);
    setTopError(null);
  }, [symbol]);

  const effectivePeakPrice = useMemo(() => {
    const parsed = Number(peakInput);
    if (peakInput.trim() !== '' && Number.isFinite(parsed) && parsed > 0) return parsed;
    return detectedPeakPrice > 0 ? detectedPeakPrice : currentClose;
  }, [peakInput, detectedPeakPrice, currentClose]);

  const effectiveEpsPrev = useMemo(() => {
    const parsed = Number(epsPrevInput);
    if (epsPrevInput.trim() !== '' && Number.isFinite(parsed)) return parsed;
    return epsPrev ?? evalData?.epsPrev ?? null;
  }, [epsPrevInput, epsPrev, evalData?.epsPrev]);

  const effectiveEpsCurr = useMemo(() => {
    const parsed = Number(epsCurrInput);
    if (epsCurrInput.trim() !== '' && Number.isFinite(parsed)) return parsed;
    return epsCurr ?? evalData?.epsCurr ?? null;
  }, [epsCurrInput, epsCurr, evalData?.epsCurr]);

  const effectiveAvgPe = useMemo(() => {
    const parsed = Number(avgPeInput);
    if (avgPeInput.trim() !== '' && Number.isFinite(parsed) && parsed > 0) return parsed;
    return trailingPE ?? evalData?.avgPeRatio ?? null;
  }, [avgPeInput, trailingPE, evalData?.avgPeRatio]);

  // Deterministic client-side formula preview for zero-latency feedback & instant alert check
  const localFormula = useMemo(() => {
    const peak = effectivePeakPrice;
    const tolFrac = zoneTolerancePct / 100;

    let epsDrop: number | null = null;
    let expectedCorrectionInr = 0;
    let expectedCorrectionPct = 0;
    let hasValuationData = false;

    if (inputMode === 'EPS_PE') {
      if (effectiveEpsPrev !== null && effectiveEpsCurr !== null) {
        epsDrop = Number((effectiveEpsPrev - effectiveEpsCurr).toFixed(2));
      }
      if (epsDrop !== null && epsDrop > 0 && effectiveAvgPe !== null && effectiveAvgPe > 0) {
        hasValuationData = true;
        expectedCorrectionInr = Math.min(peak * 0.9, Math.max(0, epsDrop * effectiveAvgPe));
        expectedCorrectionPct = peak > 0 ? (expectedCorrectionInr / peak) * 100 : 0;
      }
    } else {
      const pct = Math.min(80, Math.max(1, Number(pctDropInput) || 10));
      hasValuationData = true;
      expectedCorrectionPct = pct;
      expectedCorrectionInr = peak * (pct / 100);
    }

    const uTurnTarget = Number(Math.max(0.05, peak - expectedCorrectionInr).toFixed(2));
    const zoneLow = Number((uTurnTarget * (1 - tolFrac)).toFixed(2));
    const zoneHigh = Number((uTurnTarget * (1 + tolFrac)).toFixed(2));
    const distFromTargetPct =
      uTurnTarget > 0 ? ((currentClose - uTurnTarget) / uTurnTarget) * 100 : 0;

    const inZoneNow = hasValuationData && currentClose >= zoneLow && currentClose <= zoneHigh;
    const belowZoneNow = hasValuationData && currentClose < zoneLow;
    const delivPass = (liveDeliveryPct ?? 0) >= DELIVERY_THRESHOLD;
    const rvolPass = (liveRvol ?? 0) >= RVOL_THRESHOLD;

    return {
      peak,
      epsDrop,
      hasValuationData,
      expectedCorrectionInr,
      expectedCorrectionPct,
      uTurnTarget,
      zoneLow,
      zoneHigh,
      distFromTargetPct,
      inZoneNow,
      belowZoneNow,
      delivPass,
      rvolPass,
      delivDelta: liveDeliveryPct !== null ? liveDeliveryPct - DELIVERY_THRESHOLD : null,
      rvolDelta: liveRvol !== null ? liveRvol - RVOL_THRESHOLD : null,
    };
  }, [
    effectivePeakPrice,
    effectiveEpsPrev,
    effectiveEpsCurr,
    effectiveAvgPe,
    zoneTolerancePct,
    inputMode,
    pctDropInput,
    currentClose,
    liveDeliveryPct,
    liveRvol,
  ]);

  const dispatchNotification = useCallback(
    (alert: SupportZoneAlert, forceNotify = false) => {
      const exists = alertsLogRef.current.some((a) => a.dedupKey === alert.dedupKey);
      if (!forceNotify && exists) {
        return false;
      }

      setAlertsLog((prev) => {
        const filtered = prev.filter((a) => a.dedupKey !== alert.dedupKey);
        return [alert, ...filtered].slice(0, 50);
      });
      setActiveToastAlert(alert);

      if (soundEnabled) {
        playAlertChime();
      }

      if (
        browserNotify &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification(`U-Turn Support Zone Alert: ${alert.symbol}`, {
            body: `Close ₹${alert.closePrice.toFixed(2)} entered Support Zone ₹${alert.zoneLow.toFixed(
              2
            )}–₹${alert.zoneHigh.toFixed(2)} (Target ₹${alert.uTurnTarget.toFixed(2)}). Deliv ${
              alert.delivPer !== null ? `${alert.delivPer.toFixed(1)}%` : '—'
            } · RVOL ${alert.rvol !== null ? `${alert.rvol.toFixed(2)}x` : '—'}`,
            tag: alert.dedupKey,
          });
        } catch {
          // Ignore iframe notification restrictions
        }
      }
      return true;
    },
    [soundEnabled, browserNotify]
  );

  // Automated Watch Trigger: fires automatically whenever active stock enters its EPS-derived Support Zone
  useEffect(() => {
    if (!alertsArmed || strategy !== 'BOTTOM' || !localFormula.hasValuationData) return;

    const priceEnteredZone = localFormula.inZoneNow;
    const techAligned = localFormula.delivPass && localFormula.rvolPass;
    const triggered =
      alertCondition === 'ZONE_ENTRY' ? priceEnteredZone : priceEnteredZone && techAligned;

    if (!triggered) return;

    const dedupKey = `${symbol}|${latestDate}|${localFormula.zoneLow.toFixed(
      2
    )}|${localFormula.zoneHigh.toFixed(2)}|${alertCondition}`;

    const newAlert: SupportZoneAlert = {
      id: `${Date.now()}-${symbol}`,
      dedupKey,
      symbol,
      eodDate: latestDate,
      triggeredAtIso: new Date().toISOString(),
      closePrice: currentClose,
      uTurnTarget: localFormula.uTurnTarget,
      zoneLow: localFormula.zoneLow,
      zoneHigh: localFormula.zoneHigh,
      epsDrop: localFormula.epsDrop,
      avgPeRatio: effectiveAvgPe,
      delivPer: liveDeliveryPct,
      rvol: liveRvol,
      basisLabel: inputMode === 'EPS_PE' ? 'EPS × Avg PE' : `${pctDropInput}% Pullback`,
      condition: alertCondition,
      acknowledged: false,
    };

    dispatchNotification(newAlert, false);
  }, [
    alertsArmed,
    strategy,
    localFormula,
    alertCondition,
    symbol,
    latestDate,
    currentClose,
    effectiveAvgPe,
    liveDeliveryPct,
    liveRvol,
    inputMode,
    pctDropInput,
    dispatchNotification,
  ]);

  const handleToggleBrowserNotify = async () => {
    if (typeof Notification === 'undefined') {
      setBrowserPerm('unsupported');
      return;
    }
    if (browserNotify) {
      setBrowserNotify(false);
      return;
    }
    if (Notification.permission === 'granted') {
      setBrowserPerm('granted');
      setBrowserNotify(true);
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setBrowserPerm(perm);
      setBrowserNotify(perm === 'granted');
    } catch {
      setBrowserNotify(false);
    }
  };

  const handleScanUniverseAlerts = async () => {
    setScanningUniverse(true);
    setScanSummary(null);
    try {
      const endpoints = [
        '/api/screener?uTurn=ACTIVE_TRIGGER&liquidity=ALL&delivery=ALL&limit=30',
        '/api/screener?uTurn=CONFIRMED_SUPPORT&liquidity=ALL&delivery=ALL&limit=30',
        '/api/screener?uTurn=IN_ZONE&liquidity=ALL&delivery=ALL&limit=30',
      ];
      const responses = await Promise.all(endpoints.map((u) => fetch(u).then((r) => r.json())));
      const allRows: ScreenerRow[] = [];
      const seen = new Set<string>();
      for (const res of responses) {
        for (const r of (res.rows || []) as ScreenerRow[]) {
          if (!seen.has(r.symbol)) {
            seen.add(r.symbol);
            allRows.push(r);
          }
        }
      }

      // Filter strictly to EPS_PE valuation setups currently inside zone (±3% around target) or triggered
      const matched = allRows.filter((r) => {
        if (r.uTurnBasis !== 'EPS_PE' || r.uTurnTarget === null) return false;
        const zoneLow = r.uTurnTarget * (1 - zoneTolerancePct / 100);
        const zoneHigh = r.uTurnTarget * (1 + zoneTolerancePct / 100);
        const inZone = r.closePrice >= zoneLow && r.closePrice <= zoneHigh;
        if (alertCondition === 'ZONE_WITH_TECH') {
          return inZone && (r.delivPer ?? 0) >= 60 && (r.rvol ?? 0) >= 1.5;
        }
        return inZone || r.uTurnStatus === 'ACTIVE_TRIGGER';
      });

      let addedCount = 0;
      for (const r of matched) {
        const tgt = r.uTurnTarget!;
        const zoneLow = Number((tgt * (1 - zoneTolerancePct / 100)).toFixed(2));
        const zoneHigh = Number((tgt * (1 + zoneTolerancePct / 100)).toFixed(2));
        const dedupKey = `${r.symbol}|${r.latestDate}|${zoneLow.toFixed(2)}|${zoneHigh.toFixed(
          2
        )}|${alertCondition}`;
        const alertObj: SupportZoneAlert = {
          id: `${Date.now()}-${r.symbol}`,
          dedupKey,
          symbol: r.symbol,
          eodDate: r.latestDate,
          triggeredAtIso: new Date().toISOString(),
          closePrice: r.closePrice,
          uTurnTarget: Number(tgt.toFixed(2)),
          zoneLow,
          zoneHigh,
          epsDrop: null,
          avgPeRatio: null,
          delivPer: r.delivPer,
          rvol: r.rvol,
          basisLabel: 'EPS × Avg PE',
          condition: alertCondition,
          acknowledged: false,
        };
        if (dispatchNotification(alertObj, false)) {
          addedCount++;
        }
      }

      setAlertLogOpen(true);
      setScanSummary(
        matched.length === 0
          ? 'No additional EPS×PE stocks matched Support Zone entry on latest EOD.'
          : `Found ${matched.length} EPS×PE stock(s) in Support Zone (${addedCount} new alert${
              addedCount === 1 ? '' : 's'
            } logged).`
      );
    } catch (err) {
      setScanSummary(`Scan failed: ${(err as Error).message}`);
    } finally {
      setScanningUniverse(false);
    }
  };

  const acknowledgeAlert = (id: string) => {
    setAlertsLog((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
    if (activeToastAlert?.id === id) {
      setActiveToastAlert(null);
    }
  };

  const markAllRead = () => {
    setAlertsLog((prev) => prev.map((a) => ({ ...a, acknowledged: true })));
    setActiveToastAlert(null);
  };

  const clearAlertLog = () => {
    setAlertsLog([]);
    setActiveToastAlert(null);
  };

  // Fetch backend U-Turn confirmation (retrieves live Yahoo EPS if missing + checks subsequent sessions)
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setEvalLoading(true);
      setEvalError(null);
      try {
        const qs = new URLSearchParams({
          zoneTolerancePct: String(zoneTolerancePct),
          correctionMode: inputMode === 'EPS_PE' ? 'EPS_VALUATION' : 'PCT',
        });
        if (peakInput.trim() !== '' && Number(peakInput) > 0) {
          qs.set('peakPrice', peakInput.trim());
        }
        if (inputMode === 'EPS_PE') {
          if (epsPrevInput.trim() !== '' && Number.isFinite(Number(epsPrevInput))) {
            qs.set('epsPrev', epsPrevInput.trim());
          }
          if (epsCurrInput.trim() !== '' && Number.isFinite(Number(epsCurrInput))) {
            qs.set('epsCurr', epsCurrInput.trim());
          }
          if (avgPeInput.trim() !== '' && Number(avgPeInput) > 0) {
            qs.set('avgPeRatio', avgPeInput.trim());
          }
        } else {
          const p = Number(pctDropInput);
          if (Number.isFinite(p) && p > 0) {
            qs.set('correctionPct', String(p));
          }
        }

        const res = await fetch(
          `/api/stock/${encodeURIComponent(symbol)}/uturn?${qs.toString()}`,
          { signal: controller.signal }
        );
        const json: UTurnEvaluation & { error?: string } = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setEvalData(json);

        if (
          !userPickedStrategy &&
          inputMode === 'EPS_PE' &&
          json.epsPrev !== null &&
          json.epsCurr !== null &&
          json.epsCurr > json.epsPrev
        ) {
          setStrategy('TOP');
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setEvalError((err as Error).message || 'U-Turn check failed.');
        }
      } finally {
        setEvalLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    symbol,
    zoneTolerancePct,
    inputMode,
    peakInput,
    epsPrevInput,
    epsCurrInput,
    avgPeInput,
    pctDropInput,
    userPickedStrategy,
  ]);

  // Fetch Turnaround Top when TOP strategy tab is active
  useEffect(() => {
    if (strategy !== 'TOP') return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setTopLoading(true);
      setTopError(null);
      try {
        const qs = new URLSearchParams();
        if (topEffEpsInput.trim() !== '' && Number(topEffEpsInput) > 0) {
          qs.set('effectiveEps', topEffEpsInput.trim());
        }
        if (topPeakPeInput.trim() !== '' && Number(topPeakPeInput) > 0) {
          qs.set('peakPeRatio', topPeakPeInput.trim());
        }
        const res = await fetch(
          `/api/stock/${encodeURIComponent(symbol)}/uturn-top?${qs.toString()}`,
          { signal: controller.signal }
        );
        const json: TurnaroundTopEvaluation & { error?: string } = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setTopData(json);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setTopError((err as Error).message || 'Turnaround Top check failed.');
          setTopData(null);
        }
      } finally {
        setTopLoading(false);
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [symbol, strategy, topEffEpsInput, topPeakPeInput]);

  const bottomSvg = useMemo(() => {
    if (!evalData || evalData.noEpsDropInData || evalData.chartPoints.length < 2) return null;
    const pts = evalData.chartPoints;
    const width = 880;
    const height = 160;
    const padL = 56;
    const padR = 88;
    const padT = 14;
    const padB = 24;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const allPrices = [
      evalData.zoneLow,
      evalData.zoneHigh,
      evalData.uTurnTarget,
      ...pts.map((p) => p.close),
      ...pts.map((p) => p.low),
    ];
    const minY = Math.min(...allPrices) * 0.985;
    const maxY = Math.max(...allPrices) * 1.015;
    const span = Math.max(maxY - minY, 0.01);

    const xFor = (i: number) =>
      pts.length <= 1 ? padL + plotW / 2 : padL + (i / (pts.length - 1)) * plotW;
    const yFor = (p: number) => padT + (1 - (p - minY) / span) * plotH;

    return {
      width,
      height,
      padL,
      padR,
      plotW,
      xFor,
      yFor,
      polyline: pts.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.close).toFixed(1)}`).join(' '),
      zoneTopY: yFor(evalData.zoneHigh),
      zoneBotY: yFor(evalData.zoneLow),
      zoneBandH: Math.max(2, yFor(evalData.zoneLow) - yFor(evalData.zoneHigh)),
      targetY: yFor(evalData.uTurnTarget),
    };
  }, [evalData]);

  const topSvg = useMemo(() => {
    if (
      !topData ||
      topData.noDataOrNoJump ||
      topData.chartPoints.length < 2 ||
      topData.zoneLow === null ||
      topData.zoneHigh === null ||
      topData.topTargetPrice === null
    ) {
      return null;
    }
    const pts = topData.chartPoints;
    const width = 880;
    const height = 160;
    const padL = 56;
    const padR = 88;
    const padT = 14;
    const padB = 24;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const allPrices = [
      topData.zoneLow,
      topData.zoneHigh,
      topData.topTargetPrice,
      ...pts.map((p) => p.close),
      ...pts.map((p) => p.high),
    ];
    const minY = Math.min(...allPrices) * 0.985;
    const maxY = Math.max(...allPrices) * 1.015;
    const span = Math.max(maxY - minY, 0.01);

    const xFor = (i: number) =>
      pts.length <= 1 ? padL + plotW / 2 : padL + (i / (pts.length - 1)) * plotW;
    const yFor = (p: number) => padT + (1 - (p - minY) / span) * plotH;

    return {
      width,
      height,
      padL,
      padR,
      plotW,
      xFor,
      yFor,
      polyline: pts.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.close).toFixed(1)}`).join(' '),
      zoneTopY: yFor(topData.zoneHigh),
      zoneBotY: yFor(topData.zoneLow),
      zoneBandH: Math.max(2, yFor(topData.zoneLow) - yFor(topData.zoneHigh)),
      targetY: yFor(topData.topTargetPrice),
    };
  }, [topData]);

  const hasBottomOverrides =
    peakInput.trim() !== '' ||
    epsPrevInput.trim() !== '' ||
    epsCurrInput.trim() !== '' ||
    avgPeInput.trim() !== '';

  const hasTopOverrides = topEffEpsInput.trim() !== '' || topPeakPeInput.trim() !== '';

  const delivBarPct = liveDeliveryPct !== null ? Math.min(100, Math.max(0, liveDeliveryPct)) : 0;
  const rvolBarPct = liveRvol !== null ? Math.min(100, Math.max(0, (liveRvol / 3.0) * 100)) : 0;
  const unreadCount = alertsLog.filter((a) => !a.acknowledged).length;

  return (
    <section
      aria-label="U-Turn Strategy Monitor"
      className="bg-white border border-slate-200 rounded-lg p-5 space-y-5"
    >
      {/* Header & Strategy Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            {strategy === 'BOTTOM' ? (
              <Target className="w-4 h-4 text-blue-700" />
            ) : (
              <TrendingUp className="w-4 h-4 text-amber-700" />
            )}
            U-Turn Strategy Monitor
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {symbol} · EOD {latestDate} · Peak Price &amp; EPS Valuation Support Zone vs live Delivery % (&ge;60%) and RVOL (&ge;1.5x)
          </p>
        </div>

        <div className="inline-flex p-1 bg-slate-100 rounded-lg self-start lg:self-center">
          <button
            type="button"
            onClick={() => {
              setUserPickedStrategy(true);
              setStrategy('BOTTOM');
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              strategy === 'BOTTOM'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Bottom U-Turn (EPS Drop)
          </button>
          <button
            type="button"
            onClick={() => {
              setUserPickedStrategy(true);
              setStrategy('TOP');
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              strategy === 'TOP'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Turnaround Top (EPS × Peak PE)
          </button>
        </div>
      </div>

      {/* Automated Support Zone Alert Toolbar */}
      <div className="bg-slate-50/80 border border-slate-200/80 rounded-md px-3.5 py-2.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setAlertsArmed((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium border transition-colors whitespace-nowrap shrink-0 ${
              alertsArmed
                ? 'bg-blue-700 text-white border-blue-700 hover:bg-blue-800'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
            }`}
          >
            {alertsArmed ? <BellRing className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
            {alertsArmed ? 'Auto-Alert Armed' : 'Auto-Alert Paused'}
          </button>

          <div className="inline-flex p-0.5 bg-slate-200/70 rounded-md">
            <button
              type="button"
              onClick={() => setAlertCondition('ZONE_ENTRY')}
              className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap ${
                alertCondition === 'ZONE_ENTRY'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Trigger: Zone Entry
            </button>
            <button
              type="button"
              onClick={() => setAlertCondition('ZONE_WITH_TECH')}
              className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap ${
                alertCondition === 'ZONE_WITH_TECH'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Zone + Deliv≥60% &amp; RVOL≥1.5x
            </button>
          </div>

          <span className="font-mono tabular-nums text-[11px] text-slate-600">
            {strategy === 'BOTTOM' && localFormula.hasValuationData
              ? `Watching ₹${localFormula.zoneLow.toFixed(2)}–₹${localFormula.zoneHigh.toFixed(2)}`
              : 'Waiting for EPS Drop valuation zone'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleScanUniverseAlerts}
            disabled={scanningUniverse}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 rounded-md whitespace-nowrap shrink-0"
          >
            <Radar className={`w-3.5 h-3.5 text-blue-700 ${scanningUniverse ? 'animate-spin' : ''}`} />
            {scanningUniverse ? 'Scanning EPS×PE Zones...' : 'Scan All EPS×PE Zones'}
          </button>

          <button
            type="button"
            onClick={handleToggleBrowserNotify}
            disabled={browserPerm === 'unsupported' || browserPerm === 'denied'}
            title={
              browserPerm === 'denied'
                ? 'Browser notifications blocked in browser settings'
                : 'Enable OS/Browser push notifications when zone alert triggers'
            }
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border whitespace-nowrap shrink-0 ${
              browserNotify
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-medium'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 disabled:opacity-50'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            {browserPerm === 'denied'
              ? 'Push Blocked'
              : browserNotify
                ? 'Desktop Push On'
                : 'Desktop Push'}
          </button>

          <button
            type="button"
            onClick={() => setSoundEnabled((v) => !v)}
            aria-label="Toggle alert sound chime"
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border whitespace-nowrap shrink-0 ${
              soundEnabled
                ? 'bg-blue-50 text-blue-700 border-blue-200 font-medium'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            Chime
          </button>

          <button
            type="button"
            onClick={() => setAlertLogOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-100 rounded-md whitespace-nowrap shrink-0 font-mono tabular-nums"
          >
            Alerts Log ({alertsLog.length}
            {unreadCount > 0 ? ` · ${unreadCount} New` : ''})
          </button>
        </div>
      </div>

      {/* Live Support-Zone Entry Notification Banner */}
      {activeToastAlert && (
        <div
          role="status"
          aria-live="polite"
          className="bg-blue-50 border border-blue-300 rounded-md p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-start gap-2.5">
            <BellRing className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-semibold text-blue-950">
                Support Zone Alert Triggered: {activeToastAlert.symbol} entered ₹
                {activeToastAlert.zoneLow.toFixed(2)}–₹{activeToastAlert.zoneHigh.toFixed(2)}
              </div>
              <div className="font-mono tabular-nums text-blue-900">
                EOD {activeToastAlert.eodDate} · Close ₹{activeToastAlert.closePrice.toFixed(2)} ·
                U-Turn Target ₹{activeToastAlert.uTurnTarget.toFixed(2)} ({activeToastAlert.basisLabel})
                · Deliv {activeToastAlert.delivPer !== null ? `${activeToastAlert.delivPer.toFixed(1)}%` : '—'} · RVOL{' '}
                {activeToastAlert.rvol !== null ? `${activeToastAlert.rvol.toFixed(2)}x` : '—'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => acknowledgeAlert(activeToastAlert.id)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap"
            >
              <Check className="w-3.5 h-3.5" />
              Acknowledge
            </button>
            <button
              type="button"
              onClick={() => setActiveToastAlert(null)}
              aria-label="Dismiss notification"
              className="p-1.5 text-blue-800 hover:bg-blue-100 rounded-md"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {scanSummary && (
        <div className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 flex items-center justify-between">
          <span>{scanSummary}</span>
          <button
            type="button"
            onClick={() => setScanSummary(null)}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Dismiss scan summary"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Collapsible Support Zone Alert History Log */}
      {alertLogOpen && (
        <div className="border border-slate-200 rounded-md overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-800">
              Triggered Support Zone Notifications ({alertsLog.length})
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded"
                >
                  Mark All Read
                </button>
              )}
              {alertsLog.length > 0 && (
                <button
                  type="button"
                  onClick={clearAlertLog}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear Log
                </button>
              )}
            </div>
          </div>
          {alertsLog.length === 0 ? (
            <div className="p-4 text-xs text-slate-500">
              No support zone alerts triggered yet. Armed monitor will fire automatically whenever price enters the calculated EPS × Avg PE Support Zone, or click &ldquo;Scan All EPS×PE Zones&rdquo;.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-60 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-slate-200 text-slate-600 font-medium">
                    <th className="py-2 px-3">Symbol</th>
                    <th className="py-2 px-3">EOD Date</th>
                    <th className="py-2 px-3 text-right">Close (₹)</th>
                    <th className="py-2 px-3 text-right">Target (₹)</th>
                    <th className="py-2 px-3 text-right">Support Zone</th>
                    <th className="py-2 px-3 text-right">Deliv %</th>
                    <th className="py-2 px-3 text-right">RVOL</th>
                    <th className="py-2 px-3">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {alertsLog.map((a) => (
                    <tr
                      key={a.id}
                      className={a.acknowledged ? 'bg-white' : 'bg-blue-50/35'}
                    >
                      <td className="py-2 px-3 font-mono font-semibold">
                        {onSelectSymbol ? (
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(a.symbol)}
                            className="text-blue-700 hover:underline"
                          >
                            {a.symbol}
                          </button>
                        ) : (
                          a.symbol
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono tabular-nums text-slate-600">
                        {a.eodDate}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900">
                        {a.closePrice.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-blue-700">
                        {a.uTurnTarget.toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                        {a.zoneLow.toFixed(0)}–{a.zoneHigh.toFixed(0)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          (a.delivPer ?? 0) >= 60 ? 'text-emerald-700 font-semibold' : 'text-slate-600'
                        }`}
                      >
                        {a.delivPer !== null ? `${a.delivPer.toFixed(1)}%` : '—'}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          (a.rvol ?? 0) >= 1.5 ? 'text-blue-700 font-semibold' : 'text-slate-600'
                        }`}
                      >
                        {a.rvol !== null ? `${a.rvol.toFixed(2)}x` : '—'}
                      </td>
                      <td className="py-2 px-3 font-mono">
                        {a.acknowledged ? (
                          <span className="text-slate-400">Read</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => acknowledgeAlert(a.id)}
                            className="text-blue-700 font-semibold hover:underline"
                          >
                            Acknowledge
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {strategy === 'BOTTOM' ? (
        <>
          {/* Input Strip: Peak Price + EPS Drop + Avg PE + Band Tolerance */}
          <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 flex-1 text-xs">
              <label className="block">
                <span className="block text-slate-500 mb-1">
                  Peak Price (₹){' '}
                  <span className="font-mono text-slate-400">
                    {detectedPeakDate ? `· ${detectedPeakDate}` : ''}
                  </span>
                </span>
                <input
                  type="number"
                  step="0.05"
                  min="1"
                  value={peakInput}
                  placeholder={effectivePeakPrice.toFixed(2)}
                  onChange={(e) => setPeakInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                />
              </label>

              {inputMode === 'EPS_PE' ? (
                <>
                  <label className="block">
                    <span className="block text-slate-500 mb-1">
                      EPS Prev (₹)
                      {(epsPrevPeriod || evalData?.epsPrevPeriod) && (
                        <span className="font-mono text-slate-400">
                          {' '}
                          · {epsPrevPeriod || evalData?.epsPrevPeriod}
                        </span>
                      )}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      value={epsPrevInput}
                      placeholder={effectiveEpsPrev !== null ? effectiveEpsPrev.toFixed(2) : 'Missing'}
                      onChange={(e) => setEpsPrevInput(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-slate-500 mb-1">
                      EPS Curr (₹)
                      {(epsCurrPeriod || evalData?.epsCurrPeriod) && (
                        <span className="font-mono text-slate-400">
                          {' '}
                          · {epsCurrPeriod || evalData?.epsCurrPeriod}
                        </span>
                      )}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      value={epsCurrInput}
                      placeholder={effectiveEpsCurr !== null ? effectiveEpsCurr.toFixed(2) : 'Missing'}
                      onChange={(e) => setEpsCurrInput(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-slate-500 mb-1">Avg PE Ratio (x)</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={avgPeInput}
                      placeholder={effectiveAvgPe !== null ? effectiveAvgPe.toFixed(2) : 'Missing'}
                      onChange={(e) => setAvgPeInput(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                    />
                  </label>
                </>
              ) : (
                <label className="block">
                  <span className="block text-slate-500 mb-1">Pullback Override (%)</span>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="80"
                    value={pctDropInput}
                    onChange={(e) => setPctDropInput(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  />
                </label>
              )}

              <div className="flex flex-col justify-end gap-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="inline-flex p-0.5 bg-slate-100 rounded-md">
                    <button
                      type="button"
                      onClick={() => setInputMode('EPS_PE')}
                      className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                        inputMode === 'EPS_PE'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      EPS × PE
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputMode('PCT')}
                      className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                        inputMode === 'PCT'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      % Pullback
                    </button>
                  </div>

                  <div className="inline-flex p-0.5 bg-slate-100 rounded-md" title="Support zone width">
                    {([2, 3] as const).map((tol) => (
                      <button
                        key={tol}
                        type="button"
                        onClick={() => setZoneTolerancePct(tol)}
                        className={`px-2 py-1 rounded font-mono text-xs whitespace-nowrap ${
                          zoneTolerancePct === tol
                            ? 'bg-white text-slate-900 font-medium shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        ±{tol}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {hasBottomOverrides && (
              <button
                type="button"
                onClick={() => {
                  setPeakInput('');
                  setEpsPrevInput('');
                  setEpsCurrInput('');
                  setAvgPeInput('');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0 self-start xl:self-end"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset to Live Data
              </button>
            )}
          </div>

          {/* Calculated Valuation Outputs Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="text-xs text-slate-500">EPS Drop</div>
              <div
                className={`mt-1 text-lg font-mono tabular-nums font-bold ${
                  (localFormula.epsDrop ?? 0) > 0 ? 'text-rose-700' : 'text-slate-900'
                }`}
              >
                {inputMode === 'PCT'
                  ? 'N/A (% Mode)'
                  : localFormula.epsDrop !== null
                    ? `₹${localFormula.epsDrop.toFixed(2)}`
                    : '—'}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                {effectiveEpsPrev !== null && effectiveEpsCurr !== null
                  ? `₹${effectiveEpsPrev.toFixed(2)} -> ₹${effectiveEpsCurr.toFixed(2)}`
                  : 'Waiting for quarterly EPS'}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">Expected Correction</div>
              <div className="mt-1 text-lg font-mono tabular-nums font-bold text-slate-900">
                {localFormula.hasValuationData
                  ? `₹${localFormula.expectedCorrectionInr.toFixed(2)}`
                  : '—'}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                {localFormula.hasValuationData
                  ? `${localFormula.expectedCorrectionPct.toFixed(1)}% from ₹${localFormula.peak.toFixed(2)} peak`
                  : inputMode === 'EPS_PE'
                    ? 'Requires EPS Drop > 0 & Avg PE'
                    : ''}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">U-Turn Target Price</div>
              <div className="mt-1 text-lg font-mono tabular-nums font-bold text-blue-700">
                {localFormula.hasValuationData ? `₹${localFormula.uTurnTarget.toFixed(2)}` : '—'}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                {localFormula.hasValuationData
                  ? `Close ₹${currentClose.toFixed(2)} (${localFormula.distFromTargetPct >= 0 ? '+' : ''}${localFormula.distFromTargetPct.toFixed(1)}%)`
                  : 'No EPS decline detected'}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">Support Zone (±{zoneTolerancePct}%)</div>
              <div className="mt-1 text-lg font-mono tabular-nums font-bold text-slate-900">
                {localFormula.hasValuationData
                  ? `₹${localFormula.zoneLow.toFixed(2)} – ₹${localFormula.zoneHigh.toFixed(2)}`
                  : '—'}
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                {localFormula.hasValuationData
                  ? localFormula.inZoneNow
                    ? 'Price inside target zone'
                    : localFormula.belowZoneNow
                      ? 'Price below zone low'
                      : 'Price above support zone'
                  : 'Switch to % Pullback or enter EPS'}
              </div>
            </div>
          </div>

          {/* Live Technical Indicator Comparison Panel */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pb-4 border-b border-slate-100 text-xs">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">1. Price vs Support Zone</span>
                {localFormula.hasValuationData ? (
                  localFormula.inZoneNow ? (
                    <span className="inline-flex items-center gap-1 font-mono text-emerald-700 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      IN ZONE
                    </span>
                  ) : localFormula.belowZoneNow ? (
                    <span className="inline-flex items-center gap-1 font-mono text-rose-700 font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      BELOW LOW
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-mono text-slate-600">
                      <Clock className="w-3.5 h-3.5" />
                      ABOVE ZONE
                    </span>
                  )
                ) : (
                  <span className="font-mono text-slate-400">NO TARGET</span>
                )}
              </div>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <span className="text-base font-bold text-slate-900">₹{currentClose.toFixed(2)}</span>
                <span className="text-slate-500">
                  {localFormula.hasValuationData
                    ? `Zone ₹${localFormula.zoneLow.toFixed(0)}–₹${localFormula.zoneHigh.toFixed(0)}`
                    : '—'}
                </span>
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                {localFormula.hasValuationData
                  ? `${localFormula.distFromTargetPct >= 0 ? '+' : ''}${localFormula.distFromTargetPct.toFixed(2)}% vs U-Turn Target ₹${localFormula.uTurnTarget.toFixed(2)}`
                  : 'Awaiting EPS drop > 0 or pullback %'}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">2. Live Delivery % vs 60% Gate</span>
                {liveDeliveryPct === null ? (
                  <span className="font-mono text-slate-400">MISSING</span>
                ) : localFormula.delivPass ? (
                  <span className="inline-flex items-center gap-1 font-mono text-emerald-700 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    PASS (&ge;60%)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-mono text-rose-700 font-semibold">
                    <XCircle className="w-3.5 h-3.5" />
                    BELOW 60%
                  </span>
                )}
              </div>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <span
                  className={`text-base font-bold ${
                    localFormula.delivPass ? 'text-emerald-700' : 'text-slate-900'
                  }`}
                >
                  {liveDeliveryPct !== null ? `${liveDeliveryPct.toFixed(1)}%` : '—'}
                </span>
                <span className="text-slate-500">
                  {localFormula.delivDelta !== null
                    ? `${localFormula.delivDelta >= 0 ? '+' : ''}${localFormula.delivDelta.toFixed(1)}% vs 60%`
                    : 'Benchmark 60.0%'}
                </span>
              </div>
              <div className="relative h-2 bg-slate-100 rounded-sm overflow-hidden">
                <div
                  className={`h-full ${localFormula.delivPass ? 'bg-emerald-600' : 'bg-slate-400'}`}
                  style={{ width: `${delivBarPct}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-slate-900"
                  style={{ left: `${DELIVERY_THRESHOLD}%` }}
                  title="60% Delivery Threshold"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-700">3. Live RVOL vs 1.5x Gate</span>
                {liveRvol === null ? (
                  <span className="font-mono text-slate-400">WAIT</span>
                ) : localFormula.rvolPass ? (
                  <span className="inline-flex items-center gap-1 font-mono text-blue-700 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    PASS (&ge;1.5x)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-mono text-rose-700 font-semibold">
                    <XCircle className="w-3.5 h-3.5" />
                    LOW RVOL
                  </span>
                )}
              </div>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <span
                  className={`text-base font-bold ${
                    localFormula.rvolPass ? 'text-blue-700' : 'text-slate-900'
                  }`}
                >
                  {liveRvol !== null ? `${liveRvol.toFixed(2)}x` : 'WAIT'}
                </span>
                <span className="text-slate-500">
                  {localFormula.rvolDelta !== null
                    ? `${localFormula.rvolDelta >= 0 ? '+' : ''}${localFormula.rvolDelta.toFixed(2)}x vs 1.50x`
                    : 'Benchmark 1.50x'}
                </span>
              </div>
              <div className="relative h-2 bg-slate-100 rounded-sm overflow-hidden">
                <div
                  className={`h-full ${localFormula.rvolPass ? 'bg-blue-600' : 'bg-slate-400'}`}
                  style={{ width: `${rvolBarPct}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-slate-900"
                  style={{ left: `${(RVOL_THRESHOLD / 3.0) * 100}%` }}
                  title="1.5x RVOL Threshold"
                />
              </div>
            </div>
          </div>

          {/* Backend Subsequent-Session Confirmation Verdict */}
          {evalLoading && !evalData ? (
            <div className="py-4 text-xs text-slate-500">
              Checking subsequent sessions for support hold or breakdown...
            </div>
          ) : evalError ? (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800">
              {evalError}
            </div>
          ) : evalData ? (
            <div className="space-y-4">
              <div
                className={`border rounded-md p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${STATUS_STYLE[evalData.status].surface}`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`font-semibold ${STATUS_STYLE[evalData.status].labelCls}`}>
                      {evalData.verdictLabel}
                    </span>
                    {!evalData.noEpsDropInData && (
                      <>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono tabular-nums text-slate-700">
                          {evalData.subsequentSessionsCount > 0
                            ? `Subsequent: ${evalData.heldSessionsCount}/${evalData.subsequentSessionsCount} held >= ₹${evalData.zoneLow.toFixed(2)}`
                            : evalData.touchedTargetZone
                              ? 'Touched zone on latest session — verify next session'
                              : 'Target zone not touched yet since peak'}
                        </span>
                      </>
                    )}
                  </div>
                  <p className={`text-xs leading-relaxed ${STATUS_STYLE[evalData.status].text}`}>
                    {evalData.verdictDetail}
                  </p>
                </div>

                {onSendToRisk && !evalData.noEpsDropInData && (
                  <button
                    type="button"
                    onClick={() =>
                      onSendToRisk(
                        evalData.symbol,
                        evalData.latestClose,
                        Number((evalData.zoneLow * 0.985).toFixed(2))
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0 self-start lg:self-center"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    Size Position (Stop ₹{(evalData.zoneLow * 0.985).toFixed(2)})
                  </button>
                )}
              </div>

              {bottomSvg && !evalData.noEpsDropInData && (
                <div className="pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-800">
                      Peak to Support Zone (±{evalData.zoneTolerancePct}%) Trajectory
                    </span>
                    <span className="font-mono tabular-nums text-slate-500">
                      Target ₹{evalData.uTurnTarget.toFixed(2)} · Zone ₹{evalData.zoneLow.toFixed(2)}–₹{evalData.zoneHigh.toFixed(2)}
                    </span>
                  </div>
                  <div className="overflow-x-auto border border-slate-200/80 rounded-md p-2 bg-slate-50/40">
                    <svg
                      viewBox={`0 0 ${bottomSvg.width} ${bottomSvg.height}`}
                      className="w-full min-w-[600px] h-auto select-none"
                    >
                      <rect
                        x={bottomSvg.padL}
                        y={bottomSvg.zoneTopY}
                        width={bottomSvg.plotW}
                        height={bottomSvg.zoneBandH}
                        fill="#3B82F6"
                        fillOpacity="0.10"
                      />
                      <line
                        x1={bottomSvg.padL}
                        x2={bottomSvg.width - bottomSvg.padR}
                        y1={bottomSvg.zoneTopY}
                        y2={bottomSvg.zoneTopY}
                        stroke="#60A5FA"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={bottomSvg.padL}
                        x2={bottomSvg.width - bottomSvg.padR}
                        y1={bottomSvg.zoneBotY}
                        y2={bottomSvg.zoneBotY}
                        stroke="#DC2626"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                      <line
                        x1={bottomSvg.padL}
                        x2={bottomSvg.width - bottomSvg.padR}
                        y1={bottomSvg.targetY}
                        y2={bottomSvg.targetY}
                        stroke="#1D4ED8"
                        strokeWidth="1.25"
                        strokeDasharray="5 3"
                      />
                      <text
                        x={bottomSvg.width - bottomSvg.padR + 6}
                        y={bottomSvg.targetY + 3}
                        className="fill-blue-700 text-[10px] font-mono font-semibold"
                      >
                        Tgt {evalData.uTurnTarget.toFixed(1)}
                      </text>
                      <text
                        x={bottomSvg.width - bottomSvg.padR + 6}
                        y={bottomSvg.zoneBotY + 3}
                        className="fill-rose-700 text-[10px] font-mono"
                      >
                        Low {evalData.zoneLow.toFixed(1)}
                      </text>
                      <polyline
                        fill="none"
                        stroke="#0F172A"
                        strokeWidth="2"
                        points={bottomSvg.polyline}
                      />
                      {evalData.chartPoints.map((pt, i) => {
                        const cx = bottomSvg.xFor(i);
                        const cy = bottomSvg.yFor(pt.close);
                        const fill =
                          pt.action === 'BROKE_BELOW'
                            ? '#E11D48'
                            : pt.action === 'IN_ZONE_TRIGGER'
                              ? '#1D4ED8'
                              : pt.action === 'HELD_SUPPORT' || pt.action === 'BOUNCED_ABOVE'
                                ? '#059669'
                                : pt.action === 'IN_ZONE'
                                  ? '#D97706'
                                  : pt.isPeak
                                    ? '#0F172A'
                                    : '#64748B';
                        const r = pt.action !== 'PRE_ZONE' || pt.isPeak ? 3.5 : 2;
                        return (
                          <circle
                            key={pt.date}
                            cx={cx}
                            cy={cy}
                            r={r}
                            fill={fill}
                            stroke="#FFFFFF"
                            strokeWidth="1"
                          />
                        );
                      })}
                      {[0, Math.floor(evalData.chartPoints.length / 2), evalData.chartPoints.length - 1].map(
                        (idx) => {
                          const p = evalData.chartPoints[idx];
                          if (!p) return null;
                          return (
                            <text
                              key={`mon-x-${idx}`}
                              x={bottomSvg.xFor(idx)}
                              y={bottomSvg.height - 6}
                              textAnchor="middle"
                              className="fill-slate-400 text-[10px] font-mono"
                            >
                              {p.date}
                            </text>
                          );
                        }
                      )}
                    </svg>
                  </div>
                </div>
              )}

              {evalData.subsequentSessions.length > 0 && !evalData.noEpsDropInData && (
                <div className="overflow-x-auto border border-slate-200 rounded-md">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                        <th className="py-2 px-3">Session</th>
                        <th className="py-2 px-3 text-right">Close (₹)</th>
                        <th className="py-2 px-3 text-right">Day %</th>
                        <th className="py-2 px-3 text-right">Low (₹)</th>
                        <th className="py-2 px-3 text-right">vs Target</th>
                        <th className="py-2 px-3 text-right">Deliv %</th>
                        <th className="py-2 px-3 text-right">RVOL</th>
                        <th className="py-2 px-3">Verification</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...evalData.subsequentSessions].reverse().map((s, idx, arr) => {
                        const isTouch = idx === arr.length - 1;
                        const act = formatBottomAction(s.action);
                        return (
                          <tr key={s.date} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                              {s.date}
                              {isTouch && (
                                <span className="ml-1.5 text-[11px] text-blue-700 font-semibold">
                                  (Touch)
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900">
                              {s.close.toFixed(2)}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums ${
                                (s.changePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {s.changePct !== null
                                ? `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`
                                : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums ${
                                s.low !== null && s.low < evalData.zoneLow
                                  ? 'text-rose-700'
                                  : 'text-slate-600'
                              }`}
                            >
                              {s.low !== null ? s.low.toFixed(2) : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                              {s.vsTargetPct >= 0 ? '+' : ''}
                              {s.vsTargetPct.toFixed(2)}%
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums ${
                                (s.delivPer ?? 0) >= 60
                                  ? 'text-emerald-700 font-semibold'
                                  : 'text-slate-600'
                              }`}
                            >
                              {s.delivPer !== null ? `${s.delivPer.toFixed(1)}%` : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums ${
                                (s.rvol ?? 0) >= 1.5 ? 'text-blue-700 font-semibold' : 'text-slate-600'
                              }`}
                            >
                              {s.rvol !== null ? `${s.rvol.toFixed(2)}x` : '—'}
                            </td>
                            <td className={`py-2 px-3 font-mono whitespace-nowrap ${act.cls}`}>
                              {act.label}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : (
        /* TURNAROUND TOP VIEW */
        <>
          <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-slate-100 text-xs">
            <div className="flex flex-wrap items-end gap-4">
              {topData && topData.epsQPrev !== null && topData.epsQCurr !== null && (
                <div className="pb-1.5 font-mono tabular-nums text-slate-700">
                  Q-EPS:{' '}
                  <span className="text-slate-500">₹{topData.epsQPrev.toFixed(2)}</span>
                  <span className="mx-1 text-slate-400">-&gt;</span>
                  <span
                    className={`font-semibold ${
                      topData.epsQCurr > topData.epsQPrev ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    ₹{topData.epsQCurr.toFixed(2)}
                  </span>
                  {topData.epsJumpPct !== null && (
                    <span className="ml-1.5 text-slate-500">
                      ({topData.epsJumpPct >= 0 ? '+' : ''}
                      {topData.epsJumpPct.toFixed(1)}%)
                    </span>
                  )}
                </div>
              )}

              <label className="block">
                <span className="block text-slate-500 mb-1">Effective TTM EPS (₹)</span>
                <input
                  type="number"
                  step="0.05"
                  min="0.05"
                  value={topEffEpsInput}
                  placeholder={
                    topData?.effectiveEps !== null && topData?.effectiveEps !== undefined
                      ? topData.effectiveEps.toFixed(2)
                      : 'e.g. 20'
                  }
                  onChange={(e) => setTopEffEpsInput(e.target.value)}
                  className="w-28 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:bg-white"
                />
              </label>

              <label className="block">
                <span className="block text-slate-500 mb-1">Peak PE (x)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  value={topPeakPeInput}
                  placeholder={
                    topData?.peakPeRatio !== null && topData?.peakPeRatio !== undefined
                      ? topData.peakPeRatio.toFixed(2)
                      : 'e.g. 25'
                  }
                  onChange={(e) => setTopPeakPeInput(e.target.value)}
                  className="w-24 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:bg-white"
                />
              </label>

              {hasTopOverrides && (
                <button
                  type="button"
                  onClick={() => {
                    setTopEffEpsInput('');
                    setTopPeakPeInput('');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Live TTM EPS / PE
                </button>
              )}
            </div>

            {topData && topData.topTargetPrice !== null && (
              <div className="font-mono tabular-nums text-slate-700 pb-1.5">
                Top Price Target:{' '}
                <strong className="text-slate-900">
                  ₹{topData.effectiveEps?.toFixed(2)} × {topData.peakPeRatio?.toFixed(2)}x = ₹
                  {topData.topTargetPrice.toFixed(2)}
                </strong>
              </div>
            )}
          </div>

          {topLoading && !topData ? (
            <div className="py-6 text-center text-xs text-slate-500">
              Evaluating Turnaround Top exhaustion &amp; trailing EPS valuation...
            </div>
          ) : topError || !topData ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800">
              {topError || 'Unable to compute Turnaround Top evaluation.'}
            </div>
          ) : (
            <>
              <div
                className={`border rounded-md p-4 flex flex-col gap-1 ${TOP_STATUS_STYLE[topData.status].surface}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`font-semibold ${TOP_STATUS_STYLE[topData.status].labelCls}`}>
                    {topData.verdictLabel}
                  </span>
                  {topData.topTargetPrice !== null &&
                    topData.zoneLow !== null &&
                    topData.zoneHigh !== null && (
                      <>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono tabular-nums text-slate-700">
                          Top Zone (-4%..+2%): ₹{topData.zoneLow.toFixed(2)} – ₹
                          {topData.zoneHigh.toFixed(2)} (Target ₹{topData.topTargetPrice.toFixed(2)})
                        </span>
                      </>
                    )}
                </div>
                <p className={`text-xs leading-relaxed ${TOP_STATUS_STYLE[topData.status].text}`}>
                  {topData.verdictDetail}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-4 border-b border-slate-100 text-xs">
                <div>
                  <div className="text-slate-500">1. Top Zone (-4%..+2%)</div>
                  <div className="mt-1 font-mono tabular-nums font-bold text-slate-900">
                    {topData.zoneLow !== null && topData.zoneHigh !== null
                      ? `₹${topData.zoneLow.toFixed(2)} – ₹${topData.zoneHigh.toFixed(2)}`
                      : '—'}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500">
                    Close ₹{topData.latestClose.toFixed(2)}
                    {topData.distFromTopPct !== null
                      ? ` (${topData.distFromTopPct >= 0 ? '+' : ''}${topData.distFromTopPct.toFixed(1)}% vs top)`
                      : ''}
                  </div>
                </div>

                <div>
                  <div className="text-slate-500">2. High RVOL (&ge; 1.5x)</div>
                  <div
                    className={`mt-1 font-mono tabular-nums text-base font-bold ${
                      topData.gates.highRvolPass ? 'text-amber-700' : 'text-slate-900'
                    }`}
                  >
                    {topData.triggerRvol !== null
                      ? `${topData.triggerRvol.toFixed(2)}x`
                      : topData.latestRvol !== null
                        ? `${topData.latestRvol.toFixed(2)}x`
                        : '—'}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500">
                    {topData.triggerDate ? `Trigger ${topData.triggerDate}` : `Latest EOD (${topData.latestDate})`}
                  </div>
                </div>

                <div>
                  <div className="text-slate-500">3. Falling / Low Delivery</div>
                  <div
                    className={`mt-1 font-mono tabular-nums text-base font-bold ${
                      topData.gates.lowDeliveryPass ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {topData.triggerDelivPer !== null
                      ? `${topData.triggerDelivPer.toFixed(1)}%`
                      : topData.latestDelivPer !== null
                        ? `${topData.latestDelivPer.toFixed(1)}%`
                        : '—'}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500">
                    20D Avg: {topData.avgDelivery20D !== null ? `${topData.avgDelivery20D.toFixed(1)}%` : '—'}
                  </div>
                </div>

                <div>
                  <div className="text-slate-500">4. Subsequent Distribution</div>
                  <div
                    className={`mt-1 font-mono tabular-nums text-base font-bold ${
                      topData.status === 'CONFIRMED_TOP'
                        ? 'text-rose-700'
                        : topData.status === 'TOP_BREAKOUT'
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                    }`}
                  >
                    {topData.subsequentSessionsCount > 0
                      ? `${topData.rejectedSessionsCount}/${topData.subsequentSessionsCount} Rejected`
                      : topData.touchedTopZone && !topData.noDataOrNoJump
                        ? '0 Sessions After'
                        : 'Not Touched'}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500">
                    Follow-through confirmation
                  </div>
                </div>
              </div>

              {topSvg && topData.topTargetPrice !== null && topData.zoneLow !== null && topData.zoneHigh !== null && (
                <div className="overflow-x-auto border border-slate-200/80 rounded-md p-2 bg-slate-50/40">
                  <svg
                    viewBox={`0 0 ${topSvg.width} ${topSvg.height}`}
                    className="w-full min-w-[600px] h-auto select-none"
                  >
                    <rect
                      x={topSvg.padL}
                      y={topSvg.zoneTopY}
                      width={topSvg.plotW}
                      height={topSvg.zoneBandH}
                      fill="#F59E0B"
                      fillOpacity="0.14"
                    />
                    <line
                      x1={topSvg.padL}
                      x2={topSvg.width - topSvg.padR}
                      y1={topSvg.zoneTopY}
                      y2={topSvg.zoneTopY}
                      stroke="#059669"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <line
                      x1={topSvg.padL}
                      x2={topSvg.width - topSvg.padR}
                      y1={topSvg.zoneBotY}
                      y2={topSvg.zoneBotY}
                      stroke="#D97706"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <line
                      x1={topSvg.padL}
                      x2={topSvg.width - topSvg.padR}
                      y1={topSvg.targetY}
                      y2={topSvg.targetY}
                      stroke="#E11D48"
                      strokeWidth="1.25"
                      strokeDasharray="5 3"
                    />
                    <text
                      x={topSvg.width - topSvg.padR + 6}
                      y={topSvg.targetY + 3}
                      className="fill-rose-700 text-[10px] font-mono font-semibold"
                    >
                      Top {topData.topTargetPrice.toFixed(1)}
                    </text>
                    <text
                      x={topSvg.width - topSvg.padR + 6}
                      y={topSvg.zoneBotY + 3}
                      className="fill-amber-700 text-[10px] font-mono"
                    >
                      Zone {topData.zoneLow.toFixed(1)}
                    </text>
                    <polyline fill="none" stroke="#0F172A" strokeWidth="2" points={topSvg.polyline} />
                    {topData.chartPoints.map((pt, i) => {
                      const cx = topSvg.xFor(i);
                      const cy = topSvg.yFor(pt.close);
                      const fill =
                        pt.action === 'TOP_REJECTION'
                          ? '#E11D48'
                          : pt.action === 'TOP_TRIGGER'
                            ? '#D97706'
                            : pt.action === 'TOP_BREAKOUT'
                              ? '#059669'
                              : pt.action === 'TOP_ZONE'
                                ? '#F59E0B'
                                : '#64748B';
                      const r = pt.action !== 'PRE_TOP' ? 3.5 : 2;
                      return (
                        <circle
                          key={pt.date}
                          cx={cx}
                          cy={cy}
                          r={r}
                          fill={fill}
                          stroke="#FFFFFF"
                          strokeWidth="1"
                        />
                      );
                    })}
                    {[
                      0,
                      Math.floor(topData.chartPoints.length / 2),
                      topData.chartPoints.length - 1,
                    ].map((idx) => {
                      const p = topData.chartPoints[idx];
                      if (!p) return null;
                      return (
                        <text
                          key={`mon-top-x-${idx}`}
                          x={topSvg.xFor(idx)}
                          y={topSvg.height - 6}
                          textAnchor="middle"
                          className="fill-slate-400 text-[10px] font-mono"
                        >
                          {p.date}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              )}

              {topData.subsequentSessions.length > 0 && !topData.noDataOrNoJump && (
                <div className="overflow-x-auto border border-slate-200 rounded-md">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                        <th className="py-2 px-3">Session</th>
                        <th className="py-2 px-3 text-right">Close (₹)</th>
                        <th className="py-2 px-3 text-right">Day %</th>
                        <th className="py-2 px-3 text-right">High (₹)</th>
                        <th className="py-2 px-3 text-right">vs Top</th>
                        <th className="py-2 px-3 text-right">Deliv %</th>
                        <th className="py-2 px-3 text-right">RVOL</th>
                        <th className="py-2 px-3">Verification</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...topData.subsequentSessions].reverse().map((s, idx, arr) => {
                        const isTouch = idx === arr.length - 1;
                        const act = formatTopAction(s.action);
                        return (
                          <tr key={s.date} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-mono tabular-nums text-slate-800 whitespace-nowrap">
                              {s.date}
                              {isTouch && (
                                <span className="ml-1.5 text-[11px] text-amber-700 font-semibold">
                                  (Touch)
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900">
                              {s.close.toFixed(2)}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums ${
                                (s.changePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                              }`}
                            >
                              {s.changePct !== null
                                ? `${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%`
                                : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                              {s.high !== null ? s.high.toFixed(2) : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                              {s.vsTopPct >= 0 ? '+' : ''}
                              {s.vsTopPct.toFixed(2)}%
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums ${
                                s.delivPer !== null && s.delivPer < 50
                                  ? 'text-rose-700 font-semibold'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {s.delivPer !== null ? `${s.delivPer.toFixed(1)}%` : '—'}
                            </td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums ${
                                (s.rvol ?? 0) >= 1.5 ? 'text-amber-700 font-semibold' : 'text-slate-600'
                              }`}
                            >
                              {s.rvol !== null ? `${s.rvol.toFixed(2)}x` : '—'}
                            </td>
                            <td className={`py-2 px-3 font-mono whitespace-nowrap ${act.cls}`}>
                              {act.label}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
};
