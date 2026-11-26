import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  SectorDeliveryTrendPoint,
  SectorSentimentItem,
} from '../types/trading';

interface SectorDeliverySparklinesProps {
  sectors: SectorSentimentItem[];
  latestSessionDate: string;
  onSelectSector: (sector: string) => void;
}

type ScopeMode = 'MAJOR' | 'ALL';
type ShiftFilter = 'ALL' | 'ACCUM' | 'COOLING';
type SortMode = 'SHIFT_DESC' | 'ROTATION_DESC' | 'LATEST_DELIV';

function getShiftMeta(shiftPp: number): {
  label: string;
  stroke: string;
  fill: string;
  dotFill: string;
  textClass: string;
} {
  if (shiftPp >= 0.8) {
    return {
      label: 'Accumulating',
      stroke: '#059669',
      fill: '#10B981',
      dotFill: '#059669',
      textClass: 'text-emerald-700',
    };
  }
  if (shiftPp <= -0.8) {
    return {
      label: 'Cooling',
      stroke: '#E11D48',
      fill: '#F43F5E',
      dotFill: '#E11D48',
      textClass: 'text-rose-700',
    };
  }
  return {
    label: 'Steady',
    stroke: '#2563EB',
    fill: '#3B82F6',
    dotFill: '#2563EB',
    textClass: 'text-slate-700',
  };
}

interface SparklineRowChartProps {
  points: SectorDeliveryTrendPoint[];
  avg30d: number;
  shiftPp: number;
}

const SparklineRowChart: React.FC<SparklineRowChartProps> = ({
  points,
  avg30d,
  shiftPp,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const model = useMemo(() => {
    if (!points || points.length < 2) return null;
    const width = 260;
    const height = 44;
    const padX = 6;
    const padY = 6;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;

    const vals = points.map((p) => p.avgDeliveryPct);
    const minVal = Math.min(...vals, avg30d);
    const maxVal = Math.max(...vals, avg30d);
    const padRange = Math.max((maxVal - minVal) * 0.18, 2.0);
    const lo = Math.max(0, minVal - padRange);
    const hi = Math.min(100, maxVal + padRange);
    const range = Math.max(hi - lo, 1);

    const xFor = (i: number) =>
      points.length <= 1 ? padX + plotW / 2 : padX + (i / (points.length - 1)) * plotW;
    const yFor = (v: number) => padY + (1 - (v - lo) / range) * plotH;

    const linePts = points
      .map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.avgDeliveryPct).toFixed(1)}`)
      .join(' ');
    const lastX = xFor(points.length - 1).toFixed(1);
    const firstX = xFor(0).toFixed(1);
    const baseY = (padY + plotH).toFixed(1);
    const areaPath = `M ${firstX},${baseY} L ${linePts
      .split(' ')
      .join(' L ')} L ${lastX},${baseY} Z`;

    return {
      width,
      height,
      padX,
      padY,
      plotW,
      plotH,
      linePts,
      areaPath,
      yAvg: yFor(avg30d),
      xFor,
      yFor,
      sliceW: plotW / Math.max(points.length - 1, 1),
    };
  }, [points, avg30d]);

  if (!model) {
    return (
      <div className="h-11 flex items-center text-[11px] font-mono text-slate-400">
        Insufficient 30D sessions
      </div>
    );
  }

  const meta = getShiftMeta(shiftPp);
  const activeIdx =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < points.length
      ? hoverIdx
      : points.length - 1;
  const activePt = points[activeIdx];
  const isHovered = hoverIdx !== null && hoverIdx < points.length;

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="relative w-full max-w-[260px]">
        <svg
          viewBox={`0 0 ${model.width} ${model.height}`}
          className="w-full h-11 overflow-visible select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* 30D Average Dashed Baseline */}
          <line
            x1={model.padX}
            x2={model.width - model.padX}
            y1={model.yAvg}
            y2={model.yAvg}
            stroke="#94A3B8"
            strokeWidth="1"
            strokeDasharray="3 3"
          />

          {/* Subtle Area Fill */}
          <path d={model.areaPath} fill={meta.fill} fillOpacity="0.12" />

          {/* 30D Trend Line */}
          <polyline
            fill="none"
            stroke={meta.stroke}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={model.linePts}
          />

          {/* Hover Vertical Crosshair */}
          {isHovered && (
            <line
              x1={model.xFor(activeIdx)}
              x2={model.xFor(activeIdx)}
              y1={model.padY - 2}
              y2={model.height - model.padY + 2}
              stroke="#64748B"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          )}

          {/* Active / Latest Point Marker */}
          <circle
            cx={model.xFor(activeIdx)}
            cy={model.yFor(activePt.avgDeliveryPct)}
            r={isHovered ? 3.5 : 2.75}
            fill={meta.dotFill}
            stroke="#FFFFFF"
            strokeWidth="1.25"
          />

          {/* Invisible Hit Targets for Smooth Session Inspection */}
          {points.map((pt, idx) => (
            <rect
              key={pt.date}
              x={model.xFor(idx) - model.sliceW / 2}
              y={0}
              width={Math.max(4, model.sliceW)}
              height={model.height}
              fill="transparent"
              onMouseEnter={(e) => {
                e.stopPropagation();
                setHoverIdx(idx);
              }}
            />
          ))}
        </svg>
      </div>

      {/* Compact Hover / Latest Readout */}
      <div className="w-[88px] shrink-0 text-right font-mono tabular-nums leading-tight">
        <div className="text-[11px] font-semibold text-slate-800">
          {activePt.avgDeliveryPct.toFixed(1)}%
        </div>
        <div className="text-[10px] text-slate-400">{activePt.date.slice(5)}</div>
      </div>
    </div>
  );
};

export const SectorDeliverySparklines: React.FC<SectorDeliverySparklinesProps> = ({
  sectors,
  latestSessionDate,
  onSelectSector,
}) => {
  const majorCount = useMemo(
    () => sectors.filter((s) => s.stockCount >= 15).length,
    [sectors]
  );
  const [scope, setScope] = useState<ScopeMode>(majorCount >= 4 ? 'MAJOR' : 'ALL');
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('ALL');
  const [sortBy, setSortBy] = useState<SortMode>('SHIFT_DESC');

  const rowsWithTrend = useMemo(() => {
    return sectors
      .filter((s) => (s.deliveryTrend30d?.length ?? 0) >= 5)
      .map((s) => {
        const avg30d = Number((s.delivery30dAvg ?? s.avgDeliveryPct).toFixed(1));
        const avg5d = Number((s.delivery5dAvg ?? s.avgDeliveryPct).toFixed(1));
        const shiftPp = Number((avg5d - avg30d).toFixed(1));
        return {
          ...s,
          avg30d,
          avg5d,
          shiftPp,
        };
      });
  }, [sectors]);

  const rotationLeaders = useMemo(() => {
    const pool =
      scope === 'MAJOR'
        ? rowsWithTrend.filter((s) => s.stockCount >= 15)
        : rowsWithTrend;
    if (pool.length === 0) return null;
    const sorted = [...pool].sort((a, b) => b.shiftPp - a.shiftPp);
    return {
      topAccum: sorted[0],
      topCool: sorted[sorted.length - 1],
      windowStart: pool[0]?.deliveryTrend30d?.[0]?.date ?? '',
      windowEnd:
        pool[0]?.deliveryTrend30d?.[
          (pool[0]?.deliveryTrend30d?.length ?? 1) - 1
        ]?.date ?? latestSessionDate,
    };
  }, [rowsWithTrend, scope, latestSessionDate]);

  const displayedRows = useMemo(() => {
    let list = rowsWithTrend;
    if (scope === 'MAJOR') {
      list = list.filter((s) => s.stockCount >= 15);
    }
    if (shiftFilter === 'ACCUM') {
      list = list.filter((s) => s.shiftPp >= 0.8);
    } else if (shiftFilter === 'COOLING') {
      list = list.filter((s) => s.shiftPp <= -0.8);
    }

    const sorted = [...list];
    if (sortBy === 'SHIFT_DESC') {
      sorted.sort((a, b) => b.shiftPp - a.shiftPp || b.rotationScore - a.rotationScore);
    } else if (sortBy === 'ROTATION_DESC') {
      sorted.sort((a, b) => b.rotationScore - a.rotationScore || b.shiftPp - a.shiftPp);
    } else {
      sorted.sort((a, b) => b.avgDeliveryPct - a.avgDeliveryPct);
    }
    return sorted;
  }, [rowsWithTrend, scope, shiftFilter, sortBy]);

  if (rowsWithTrend.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-700 shrink-0" />
            30-Day Sector Delivery % Trend (Rotation Shifts)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Tracks 30-session average delivery % across each major NSE sector ({rotationLeaders?.windowStart} to {rotationLeaders?.windowEnd}). Dashed line = 30D mean; shift = 5D Avg − 30D Avg.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {majorCount >= 4 && (
            <div
              role="group"
              aria-label="Sector universe scope"
              className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md text-xs"
            >
              <button
                type="button"
                onClick={() => setScope('MAJOR')}
                aria-pressed={scope === 'MAJOR'}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  scope === 'MAJOR'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Major ({majorCount})
              </button>
              <button
                type="button"
                onClick={() => setScope('ALL')}
                aria-pressed={scope === 'ALL'}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  scope === 'ALL'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({rowsWithTrend.length})
              </button>
            </div>
          )}

          <div
            role="group"
            aria-label="Delivery rotation filter"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md text-xs"
          >
            {([
              { id: 'ALL', label: 'All' },
              { id: 'ACCUM', label: 'Accumulating (+)' },
              { id: 'COOLING', label: 'Cooling (−)' },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setShiftFilter(opt.id)}
                aria-pressed={shiftFilter === opt.id}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                  shiftFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Sort sectors by"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortMode)}
            className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium focus:outline-none focus:border-blue-600"
          >
            <option value="SHIFT_DESC">Sort: 5D − 30D Shift</option>
            <option value="ROTATION_DESC">Sort: Rotation Score</option>
            <option value="LATEST_DELIV">Sort: Latest Deliv %</option>
          </select>
        </div>
      </div>

      {/* Rotation Leader & Laggard Highlight Strip */}
      {rotationLeaders && (
        <div className="px-5 py-2.5 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
            <button
              type="button"
              onClick={() => onSelectSector(rotationLeaders.topAccum.sector)}
              className="inline-flex items-center gap-1.5 text-emerald-700 hover:underline font-medium"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>
                Top Delivery Surge: {rotationLeaders.topAccum.sector} (
                {rotationLeaders.topAccum.shiftPp >= 0 ? '+' : ''}
                {rotationLeaders.topAccum.shiftPp.toFixed(1)}pp)
              </span>
            </button>
            <span className="text-slate-300 hidden sm:inline">|</span>
            <button
              type="button"
              onClick={() => onSelectSector(rotationLeaders.topCool.sector)}
              className="inline-flex items-center gap-1.5 text-rose-700 hover:underline font-medium"
            >
              <TrendingDown className="w-3.5 h-3.5" />
              <span>
                Sharpest Cooling: {rotationLeaders.topCool.sector} (
                {rotationLeaders.topCool.shiftPp >= 0 ? '+' : ''}
                {rotationLeaders.topCool.shiftPp.toFixed(1)}pp)
              </span>
            </button>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            Hover any sparkline to inspect session date
          </span>
        </div>
      )}

      {/* Sparkline Chart Rows */}
      <div className="divide-y divide-slate-100">
        {displayedRows.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs text-slate-500">
            No sectors match the selected delivery shift filter.
          </div>
        ) : (
          displayedRows.map((sec) => {
            const meta = getShiftMeta(sec.shiftPp);
            const regimeTone =
              sec.regime === 'LEADING'
                ? 'text-emerald-700'
                : sec.regime === 'IMPROVING'
                  ? 'text-blue-700'
                  : sec.regime === 'NEUTRAL'
                    ? 'text-amber-700'
                    : 'text-rose-700';

            return (
              <div
                key={sec.sector}
                onClick={() => onSelectSector(sec.sector)}
                className="px-5 py-3 hover:bg-slate-50 cursor-pointer transition-colors grid grid-cols-1 md:grid-cols-12 items-center gap-3"
              >
                {/* Sector Label & Regime */}
                <div className="md:col-span-3 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-900 truncate">
                      {sec.sector}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5 flex items-center gap-2">
                    <span>{sec.stockCount} stocks</span>
                    <span className="text-slate-300">·</span>
                    <span className={`font-semibold ${regimeTone}`}>{sec.regime}</span>
                  </div>
                </div>

                {/* 30-Day Delivery % Sparkline */}
                <div className="md:col-span-5">
                  <SparklineRowChart
                    points={sec.deliveryTrend30d ?? []}
                    avg30d={sec.avg30d}
                    shiftPp={sec.shiftPp}
                  />
                </div>

                {/* 30D Avg / 5D Avg / Shift Readout */}
                <div className="md:col-span-4 flex flex-wrap md:flex-nowrap items-center justify-between md:justify-end gap-4 text-xs font-mono tabular-nums">
                  <div className="text-left md:text-right">
                    <div className="text-[10px] font-sans text-slate-400">30D Avg</div>
                    <div className="font-medium text-slate-700">
                      {sec.avg30d.toFixed(1)}%
                    </div>
                  </div>

                  <div className="text-left md:text-right">
                    <div className="text-[10px] font-sans text-slate-400">5D Avg</div>
                    <div className="font-semibold text-slate-900">
                      {sec.avg5d.toFixed(1)}%
                    </div>
                  </div>

                  <div className="text-left md:text-right min-w-[104px]">
                    <div className="text-[10px] font-sans text-slate-400">5D − 30D Shift</div>
                    <div className={`font-semibold ${meta.textClass}`}>
                      {sec.shiftPp >= 0 ? '+' : ''}
                      {sec.shiftPp.toFixed(1)}pp · {meta.label}
                    </div>
                  </div>

                  <span className="hidden sm:inline-flex items-center gap-1 text-blue-700 font-sans font-medium text-xs shrink-0">
                    Filter
                    <ArrowUpRight className="w-3 h-3" />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
