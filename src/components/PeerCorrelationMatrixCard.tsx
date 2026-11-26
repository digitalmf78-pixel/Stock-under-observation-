import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Grid,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import type {
  CorrelationCellStats,
  PeerCorrelationMatrixData,
} from '../types/trading';

interface PeerCorrelationMatrixCardProps {
  initialData?: PeerCorrelationMatrixData;
  symbol: string;
  onSelectSymbol: (symbol: string) => void;
}

type MatrixBasis = 'PRICE' | 'RETURN';

function classifyCorrelation(r: number | null, isSelf: boolean): {
  label: string;
  shortLabel: string;
  cellClass: string;
  badgeTextClass: string;
} {
  if (isSelf) {
    return {
      label: 'Self Identity',
      shortLabel: 'Self',
      cellClass: 'bg-slate-900 text-white border-slate-900',
      badgeTextClass: 'text-slate-900',
    };
  }
  if (r === null || !Number.isFinite(r)) {
    return {
      label: 'Insufficient Overlap',
      shortLabel: 'N/A',
      cellClass: 'bg-slate-50 text-slate-400 border-slate-200',
      badgeTextClass: 'text-slate-500',
    };
  }
  if (r >= 0.7) {
    return {
      label: 'Strong Positive',
      shortLabel: 'Strong +',
      cellClass: 'bg-emerald-600 text-white border-emerald-700',
      badgeTextClass: 'text-emerald-700',
    };
  }
  if (r >= 0.35) {
    return {
      label: 'Moderate Positive',
      shortLabel: 'Mod +',
      cellClass: 'bg-emerald-100 text-emerald-950 border-emerald-200',
      badgeTextClass: 'text-emerald-700',
    };
  }
  if (r >= 0.1) {
    return {
      label: 'Weak Positive',
      shortLabel: 'Weak +',
      cellClass: 'bg-emerald-50 text-emerald-900 border-emerald-200/80',
      badgeTextClass: 'text-emerald-700',
    };
  }
  if (r > -0.1) {
    return {
      label: 'Uncorrelated',
      shortLabel: 'Neutral',
      cellClass: 'bg-slate-100 text-slate-700 border-slate-200',
      badgeTextClass: 'text-slate-600',
    };
  }
  if (r > -0.5) {
    return {
      label: 'Moderate Inverse',
      shortLabel: 'Mod −',
      cellClass: 'bg-rose-100 text-rose-950 border-rose-200',
      badgeTextClass: 'text-rose-700',
    };
  }
  return {
    label: 'Strong Inverse',
    shortLabel: 'Strong −',
    cellClass: 'bg-rose-600 text-white border-rose-700',
    badgeTextClass: 'text-rose-700',
  };
}

function formatR(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return '—';
  const sign = r > 0 ? '+' : '';
  return `${sign}${r.toFixed(2)}`;
}

export const PeerCorrelationMatrixCard: React.FC<PeerCorrelationMatrixCardProps> = ({
  initialData,
  symbol,
  onSelectSymbol,
}) => {
  const [matrixData, setMatrixData] = useState<PeerCorrelationMatrixData | undefined>(
    initialData
  );
  const [basis, setBasis] = useState<MatrixBasis>('PRICE');
  const [windowDays, setWindowDays] = useState<7 | 14 | 30>(14);
  const [customPeers, setCustomPeers] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPair, setSelectedPair] = useState<[number, number]>([0, 1]);
  const [hoveredCell, setHoveredCell] = useState<[number, number] | null>(null);

  useEffect(() => {
    setMatrixData(initialData);
    setWindowDays(14);
    setCustomPeers(null);
    setError(null);
    setSelectedPair([0, 1]);
    setHoveredCell(null);
  }, [initialData, symbol]);

  const fetchMatrix = async (nextWindow: 7 | 14 | 30, nextPeers: string[] | null) => {
    if (nextWindow === 14 && nextPeers === null && initialData) {
      setMatrixData(initialData);
      setWindowDays(14);
      setCustomPeers(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ window: String(nextWindow) });
      if (nextPeers && nextPeers.length > 0) {
        qs.set('peers', nextPeers.join(','));
      }
      const res = await fetch(
        `/api/stock/${encodeURIComponent(symbol)}/correlation?${qs.toString()}`
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setMatrixData(json as PeerCorrelationMatrixData);
      setWindowDays(nextWindow);
      setCustomPeers(nextPeers);
    } catch (err) {
      setError((err as Error).message || 'Failed to compute correlation matrix.');
    } finally {
      setLoading(false);
    }
  };

  const activeMatrix: CorrelationCellStats[][] = useMemo(() => {
    if (!matrixData) return [];
    return basis === 'PRICE' ? matrixData.priceMatrix : matrixData.returnMatrix;
  }, [matrixData, basis]);

  const summaryStats = useMemo(() => {
    if (!matrixData || activeMatrix.length < 2) return null;
    const peerEntries = matrixData.peers
      .slice(1)
      .map((peer, idx) => ({
        peer,
        idx: idx + 1,
        cell: activeMatrix[0]?.[idx + 1] ?? { r: null, sampleCount: 0 },
      }))
      .filter((e) => e.cell.r !== null);

    if (peerEntries.length === 0) return null;

    const avgR =
      peerEntries.reduce((sum, e) => sum + (e.cell.r ?? 0), 0) / peerEntries.length;
    const sortedByR = [...peerEntries].sort(
      (a, b) => (b.cell.r ?? -2) - (a.cell.r ?? -2)
    );
    const strongest = sortedByR[0];
    const lowest = [...peerEntries].sort(
      (a, b) => Math.abs(a.cell.r ?? 2) - Math.abs(b.cell.r ?? 2)
    )[0];

    return {
      avgR,
      strongest,
      lowest,
    };
  }, [matrixData, activeMatrix]);

  // Determine active pair for side inspector (prefer hovered cell if off-diagonal, else selectedPair)
  const inspectedPair = useMemo<[number, number]>(() => {
    const n = matrixData?.peers.length ?? 0;
    if (n < 2) return [0, 0];
    const candidate =
      hoveredCell && hoveredCell[0] !== hoveredCell[1] ? hoveredCell : selectedPair;
    const rIdx = Math.min(Math.max(0, candidate[0]), n - 1);
    const cIdx = Math.min(Math.max(0, candidate[1]), n - 1);
    if (rIdx === cIdx) return [0, 1];
    return [rIdx, cIdx];
  }, [hoveredCell, selectedPair, matrixData?.peers.length]);

  const pairSparkline = useMemo(() => {
    if (!matrixData || matrixData.peers.length < 2) return null;
    const [idxA, idxB] = inspectedPair;
    const peerA = matrixData.peers[idxA];
    const peerB = matrixData.peers[idxB];
    const serA = matrixData.normalizedSeries.find((s) => s.symbol === peerA?.symbol);
    const serB = matrixData.normalizedSeries.find((s) => s.symbol === peerB?.symbol);
    if (!peerA || !peerB || !serA || !serB) return null;

    const getVal = (pt: {
      normBase100: number | null;
      dailyRetPct: number | null;
    }) => (basis === 'PRICE' ? pt.normBase100 : pt.dailyRetPct);

    const valsA = serA.points.map(getVal);
    const valsB = serB.points.map(getVal);
    const valid = [...valsA, ...valsB].filter(
      (v): v is number => v !== null && Number.isFinite(v)
    );
    if (valid.length < 2) return null;

    const minV = Math.min(...valid);
    const maxV = Math.max(...valid);
    const pad = Math.max((maxV - minV) * 0.15, basis === 'PRICE' ? 0.5 : 0.35);
    const lo = minV - pad;
    const hi = maxV + pad;
    const range = Math.max(hi - lo, 0.01);

    const width = 360;
    const height = 148;
    const padL = 36;
    const padR = 12;
    const padT = 14;
    const padB = 22;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const len = matrixData.sessionDates.length;

    const xFor = (i: number) =>
      len <= 1 ? padL + plotW / 2 : padL + (i / (len - 1)) * plotW;
    const yFor = (v: number) => padT + (1 - (v - lo) / range) * plotH;

    const buildPts = (arr: Array<number | null>) =>
      arr
        .map((v, i) =>
          v !== null && Number.isFinite(v)
            ? `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`
            : null
        )
        .filter((s): s is string => s !== null)
        .join(' ');

    const refLevel = basis === 'PRICE' ? 100 : 0;
    const showRef = refLevel >= lo && refLevel <= hi;

    return {
      peerA,
      peerB,
      ptsA: buildPts(valsA),
      ptsB: buildPts(valsB),
      width,
      height,
      padL,
      padR,
      padT,
      padB,
      plotH,
      lo,
      hi,
      xFor,
      yFor,
      refLevel,
      showRef,
      cell: activeMatrix[idxA]?.[idxB] ?? { r: null, sampleCount: 0 },
    };
  }, [matrixData, inspectedPair, basis, activeMatrix]);

  if (!matrixData || matrixData.peers.length < 2) {
    return null;
  }

  const currentCustomList = matrixData.peers.slice(1).map((p) => p.symbol);

  const handleSwapPeer = (slotIdx: number, nextSym: string) => {
    const nextPeers = [...currentCustomList];
    nextPeers[slotIdx] = nextSym;
    void fetchMatrix(windowDays, nextPeers);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Grid className="w-4 h-4 text-blue-700 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-900">
              {matrixData.windowDays}-Day Sector Peer Correlation Matrix
            </h3>
            <span className="text-[11px] font-mono text-slate-500">
              {matrixData.sector} · {matrixData.startDate} to {matrixData.endDate}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Pairwise Pearson correlation ({basis === 'PRICE' ? 'closing price' : 'daily % return'}) across{' '}
            <span className="font-semibold text-slate-700">{matrixData.primarySymbol}</span> and its{' '}
            {matrixData.sameSectorPeerCount === 3
              ? 'top 3 liquid sector peers'
              : matrixData.sameSectorPeerCount > 0
                ? `${matrixData.sameSectorPeerCount} sector peer${matrixData.sameSectorPeerCount > 1 ? 's' : ''} + liquid market peer${3 - matrixData.sameSectorPeerCount > 1 ? 's' : ''}`
                : 'top 3 liquid market peers (sector unmapped)'}
            . Click any cell to inspect pair trajectory.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Metric Basis Switcher */}
          <div
            role="group"
            aria-label="Correlation metric basis"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md text-xs"
          >
            <button
              type="button"
              onClick={() => setBasis('PRICE')}
              aria-pressed={basis === 'PRICE'}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                basis === 'PRICE'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Price Level
            </button>
            <button
              type="button"
              onClick={() => setBasis('RETURN')}
              aria-pressed={basis === 'RETURN'}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                basis === 'RETURN'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Daily Returns
            </button>
          </div>

          {/* Lookback Window Switcher */}
          <div
            role="group"
            aria-label="Correlation lookback window"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md text-xs"
          >
            {([7, 14, 30] as const).map((w) => (
              <button
                key={w}
                type="button"
                disabled={loading}
                onClick={() => void fetchMatrix(w, customPeers)}
                aria-pressed={windowDays === w}
                className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors whitespace-nowrap ${
                  windowDays === w
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {w}D
              </button>
            ))}
          </div>

          {loading && <RefreshCw className="w-3.5 h-3.5 text-blue-700 animate-spin" />}
        </div>
      </div>

      {error && (
        <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Summary KPI Strip */}
      {summaryStats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded-md px-3.5 py-2.5">
            <div className="text-[11px] text-slate-500">
              Mean Sector Co-Movement ({matrixData.windowDays}D)
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`text-base font-bold font-mono tabular-nums ${
                  classifyCorrelation(summaryStats.avgR, false).badgeTextClass
                }`}
              >
                {formatR(summaryStats.avgR)}
              </span>
              <span className="text-[11px] font-medium text-slate-600">
                {classifyCorrelation(summaryStats.avgR, false).label}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSelectedPair([0, summaryStats.strongest.idx])}
            className="text-left bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-md px-3.5 py-2.5 transition-colors"
          >
            <div className="text-[11px] text-slate-500">Highest Peer Correlation</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold font-mono text-slate-900">
                {summaryStats.strongest.peer.symbol}
              </span>
              <span
                className={`text-sm font-bold font-mono tabular-nums ${
                  classifyCorrelation(summaryStats.strongest.cell.r, false).badgeTextClass
                }`}
              >
                r = {formatR(summaryStats.strongest.cell.r)}
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setSelectedPair([0, summaryStats.lowest.idx])}
            className="text-left bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-md px-3.5 py-2.5 transition-colors"
          >
            <div className="text-[11px] text-slate-500">Most Decoupled / Low-Beta Peer</div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold font-mono text-slate-900">
                {summaryStats.lowest.peer.symbol}
              </span>
              <span className="text-sm font-bold font-mono tabular-nums text-slate-700">
                r = {formatR(summaryStats.lowest.cell.r)}
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Main Content: Heatmap Matrix (Left) + Pair Inspector (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-7 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1.5 text-xs">
              <thead>
                <tr>
                  <th className="text-left font-normal text-[11px] text-slate-400 px-2 pb-1 min-w-[124px]">
                    Ticker ({matrixData.windowDays}D)
                  </th>
                  {matrixData.peers.map((colPeer, colIdx) => {
                    const isHighlighted =
                      inspectedPair[0] === colIdx || inspectedPair[1] === colIdx;
                    return (
                      <th
                        key={`col-${colPeer.symbol}`}
                        className={`pb-1 px-1.5 text-center rounded transition-colors ${
                          isHighlighted ? 'bg-blue-50/70' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (!colPeer.isPrimary) onSelectSymbol(colPeer.symbol);
                          }}
                          title={
                            colPeer.isPrimary
                              ? `${colPeer.symbol} (Selected)`
                              : `Open ${colPeer.symbol} Deep-Dive`
                          }
                          className={`inline-flex items-center justify-center gap-0.5 font-mono font-bold text-xs ${
                            colPeer.isPrimary
                              ? 'text-blue-800 cursor-default'
                              : 'text-slate-900 hover:text-blue-700'
                          }`}
                        >
                          <span>{colPeer.symbol}</span>
                          {!colPeer.isPrimary && (
                            <ArrowUpRight className="w-3 h-3 text-slate-400" />
                          )}
                        </button>
                        <div className="text-[10px] font-mono font-normal text-slate-500">
                          {colPeer.isPrimary
                            ? 'Primary'
                            : colPeer.isSameSector
                              ? `Peer #${colIdx}`
                              : `Liq #${colIdx}`}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {matrixData.peers.map((rowPeer, rowIdx) => {
                  const rowHighlighted =
                    inspectedPair[0] === rowIdx || inspectedPair[1] === rowIdx;
                  return (
                    <tr key={`row-${rowPeer.symbol}`}>
                      <td
                        className={`px-2 py-1.5 rounded border text-left align-middle transition-colors ${
                          rowPeer.isPrimary
                            ? 'bg-blue-50/60 border-blue-200'
                            : rowHighlighted
                              ? 'bg-slate-50 border-slate-300'
                              : 'bg-white border-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              if (!rowPeer.isPrimary) onSelectSymbol(rowPeer.symbol);
                            }}
                            className={`font-mono font-bold text-xs text-left ${
                              rowPeer.isPrimary
                                ? 'text-blue-900 cursor-default'
                                : 'text-slate-900 hover:text-blue-700 hover:underline'
                            }`}
                          >
                            {rowPeer.symbol}
                          </button>
                          {rowPeer.returnWindowPct !== null && (
                            <span
                              className={`text-[10px] font-mono tabular-nums font-semibold ${
                                rowPeer.returnWindowPct >= 0
                                  ? 'text-emerald-700'
                                  : 'text-rose-700'
                              }`}
                            >
                              {rowPeer.returnWindowPct >= 0 ? '+' : ''}
                              {rowPeer.returnWindowPct.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 truncate max-w-[130px]">
                          ₹{rowPeer.closePrice.toFixed(1)} ·{' '}
                          {rowPeer.avgTurnover20DCr !== null
                            ? `₹${rowPeer.avgTurnover20DCr.toFixed(0)}Cr`
                            : '—'}
                        </div>
                      </td>

                      {matrixData.peers.map((colPeer, colIdx) => {
                        const cell = activeMatrix[rowIdx]?.[colIdx] ?? {
                          r: null,
                          sampleCount: 0,
                        };
                        const isSelf = rowIdx === colIdx;
                        const cls = classifyCorrelation(cell.r, isSelf);
                        const isSelected =
                          !isSelf &&
                          ((inspectedPair[0] === rowIdx && inspectedPair[1] === colIdx) ||
                            (inspectedPair[0] === colIdx && inspectedPair[1] === rowIdx));

                        return (
                          <td key={`cell-${rowPeer.symbol}-${colPeer.symbol}`} className="p-0">
                            <button
                              type="button"
                              disabled={isSelf}
                              onMouseEnter={() => {
                                if (!isSelf) setHoveredCell([rowIdx, colIdx]);
                              }}
                              onMouseLeave={() => setHoveredCell(null)}
                              onClick={() => {
                                if (!isSelf) setSelectedPair([rowIdx, colIdx]);
                              }}
                              title={
                                isSelf
                                  ? `${rowPeer.symbol} self-correlation (1.00)`
                                  : `${rowPeer.symbol} vs ${colPeer.symbol}: r = ${formatR(cell.r)} (${cell.sampleCount} sessions)`
                              }
                              className={`w-full h-14 px-2 py-1.5 rounded border flex flex-col items-center justify-center transition-all ${cls.cellClass} ${
                                isSelected
                                  ? 'ring-2 ring-blue-700 ring-offset-1'
                                  : isSelf
                                    ? 'cursor-default opacity-95'
                                    : 'hover:brightness-95 cursor-pointer'
                              }`}
                            >
                              <span className="font-mono tabular-nums font-bold text-sm leading-tight">
                                {isSelf ? '1.00' : formatR(cell.r)}
                              </span>
                              <span className="text-[10px] font-medium opacity-90 leading-tight mt-0.5">
                                {cls.shortLabel}
                              </span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Diverging Heatmap Legend */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-slate-500 mr-1">Scale:</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-600 text-white font-mono text-[10px]">
                ≤ −0.50
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-950 font-mono text-[10px]">
                −0.10
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                0.00
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-950 font-mono text-[10px]">
                +0.35
              </span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-600 text-white font-mono text-[10px]">
                ≥ +0.70
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              Pearson r ∈ [-1.00, +1.00]
            </span>
          </div>

          {/* Optional Peer Selector Bar if sector has > 3 peers */}
          {matrixData.availableSectorPeers.length > 3 && (
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[11px] font-medium text-slate-500">Swap Peers:</span>
              {matrixData.peers.slice(1).map((peer, slotIdx) => (
                <select
                  key={`swap-${slotIdx}`}
                  aria-label={`Select sector peer ${slotIdx + 1}`}
                  value={peer.symbol}
                  disabled={loading}
                  onChange={(e) => handleSwapPeer(slotIdx, e.target.value)}
                  className="px-2 py-1 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded text-slate-800 focus:outline-none focus:border-blue-600"
                >
                  {matrixData.availableSectorPeers.map((cand) => {
                    const takenElsewhere =
                      cand.symbol !== peer.symbol &&
                      currentCustomList.includes(cand.symbol);
                    return (
                      <option
                        key={cand.symbol}
                        value={cand.symbol}
                        disabled={takenElsewhere}
                      >
                        {cand.symbol}
                        {cand.avgTurnover20DCr !== null
                          ? ` (₹${cand.avgTurnover20DCr.toFixed(0)}Cr)`
                          : ''}
                      </option>
                    );
                  })}
                </select>
              ))}
              {customPeers !== null && (
                <button
                  type="button"
                  onClick={() => void fetchMatrix(windowDays, null)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset Top 3
                </button>
              )}
            </div>
          )}
        </div>

        {/* Pairwise Co-Movement Inspector (Right Column) */}
        {pairSparkline && (
          <div className="xl:col-span-5 bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wide text-slate-500">
                  Pair Trajectory Inspector
                </div>
                <div className="text-sm font-bold font-mono text-slate-900 mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-900">{pairSparkline.peerA.symbol}</span>
                  <span className="text-slate-400 font-sans font-normal text-xs">vs</span>
                  <span className="text-blue-700">{pairSparkline.peerB.symbol}</span>
                </div>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div
                  className={`text-base font-bold ${
                    classifyCorrelation(pairSparkline.cell.r, false).badgeTextClass
                  }`}
                >
                  r = {formatR(pairSparkline.cell.r)}
                </div>
                <div className="text-[10px] text-slate-500">
                  R²{' '}
                  {pairSparkline.cell.r !== null
                    ? `${(pairSparkline.cell.r * pairSparkline.cell.r * 100).toFixed(0)}%`
                    : '—'}{' '}
                  · {pairSparkline.cell.sampleCount} sessions
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-medium text-slate-700">
                {classifyCorrelation(pairSparkline.cell.r, false).label}
              </span>
              <span className="text-slate-500 font-mono">
                {basis === 'PRICE' ? 'Indexed Price (Base 100)' : 'Daily Return (%)'}
              </span>
            </div>

            {/* Dual-Line SVG Pair Comparison */}
            <div className="bg-white border border-slate-200 rounded-md p-2">
              <svg
                viewBox={`0 0 ${pairSparkline.width} ${pairSparkline.height}`}
                className="w-full h-auto select-none"
              >
                {[0, 0.5, 1].map((frac) => {
                  const y = pairSparkline.padT + frac * pairSparkline.plotH;
                  const val =
                    pairSparkline.hi - frac * (pairSparkline.hi - pairSparkline.lo);
                  return (
                    <g key={`pair-grid-${frac}`}>
                      <line
                        x1={pairSparkline.padL}
                        x2={pairSparkline.width - pairSparkline.padR}
                        y1={y}
                        y2={y}
                        stroke="#E2E8F0"
                        strokeWidth="1"
                      />
                      <text
                        x={pairSparkline.padL - 5}
                        y={y + 3}
                        textAnchor="end"
                        className="fill-slate-400 text-[9px] font-mono"
                      >
                        {basis === 'PRICE' ? val.toFixed(0) : `${val.toFixed(1)}%`}
                      </text>
                    </g>
                  );
                })}

                {pairSparkline.showRef && (
                  <line
                    x1={pairSparkline.padL}
                    x2={pairSparkline.width - pairSparkline.padR}
                    y1={pairSparkline.yFor(pairSparkline.refLevel)}
                    y2={pairSparkline.yFor(pairSparkline.refLevel)}
                    stroke="#94A3B8"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                )}

                {pairSparkline.ptsB && (
                  <polyline
                    fill="none"
                    stroke="#2563EB"
                    strokeWidth="1.8"
                    strokeDasharray="4 2"
                    points={pairSparkline.ptsB}
                  />
                )}
                {pairSparkline.ptsA && (
                  <polyline
                    fill="none"
                    stroke="#0F172A"
                    strokeWidth="2.1"
                    points={pairSparkline.ptsA}
                  />
                )}

                {[0, matrixData.sessionDates.length - 1].map((idx) => {
                  const dt = matrixData.sessionDates[idx];
                  if (!dt) return null;
                  return (
                    <text
                      key={`dt-${idx}`}
                      x={pairSparkline.xFor(idx)}
                      y={pairSparkline.height - 6}
                      textAnchor={idx === 0 ? 'start' : 'end'}
                      className="fill-slate-400 text-[9px] font-mono"
                    >
                      {dt}
                    </text>
                  );
                })}
              </svg>

              <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] font-mono px-1">
                <span className="text-slate-900 font-semibold">
                  ━ {pairSparkline.peerA.symbol} (
                  {pairSparkline.peerA.returnWindowPct !== null
                    ? `${pairSparkline.peerA.returnWindowPct >= 0 ? '+' : ''}${pairSparkline.peerA.returnWindowPct.toFixed(1)}%`
                    : '—'}
                  )
                </span>
                <span className="text-blue-700 font-semibold">
                  ╌ {pairSparkline.peerB.symbol} (
                  {pairSparkline.peerB.returnWindowPct !== null
                    ? `${pairSparkline.peerB.returnWindowPct >= 0 ? '+' : ''}${pairSparkline.peerB.returnWindowPct.toFixed(1)}%`
                    : '—'}
                  )
                </span>
              </div>
            </div>

            {/* Pair Snapshot Comparison */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {[pairSparkline.peerA, pairSparkline.peerB].map((p, idx) => (
                <div
                  key={`snap-${p.symbol}`}
                  className="bg-white border border-slate-200 rounded px-2.5 py-2 space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`font-mono font-bold ${
                        idx === 0 ? 'text-slate-900' : 'text-blue-700'
                      }`}
                    >
                      {p.symbol}
                    </span>
                    {!p.isPrimary && (
                      <button
                        type="button"
                        onClick={() => onSelectSymbol(p.symbol)}
                        className="text-[10px] text-blue-700 hover:underline font-medium inline-flex items-center gap-0.5"
                      >
                        Open
                        <ArrowUpRight className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                  <div className="font-mono text-slate-700 tabular-nums">
                    ₹{p.closePrice.toFixed(2)}{' '}
                    <span
                      className={
                        (p.changePct ?? 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'
                      }
                    >
                      {p.changePct !== null
                        ? `(${p.changePct >= 0 ? '+' : ''}${p.changePct.toFixed(1)}%)`
                        : ''}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500">
                    Deliv: {p.delivPer !== null ? `${p.delivPer.toFixed(1)}%` : '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
