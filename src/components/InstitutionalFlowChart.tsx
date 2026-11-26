import React, { useMemo, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { StockDetailData } from '../types/trading';

interface InstitutionalFlowChartProps {
  symbol: string;
  history: StockDetailData['history'];
}

type FlowUnit = 'VALUE_CR' | 'SHARES';

interface FlowPoint {
  date: string;
  close: number;
  changePct: number;
  delivQty: number;
  delivPer: number | null;
  delivValueCr: number;
  delivRatio: number;
  signedValCr: number;
  signedQty: number;
  cumValCr: number;
  cumQty: number;
  sma5ValCr: number | null;
  sma5Qty: number | null;
  zoneType: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
}

function formatShares(qty: number): string {
  const abs = Math.abs(qty);
  const sign = qty < 0 ? '-' : qty > 0 ? '+' : '';
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)} K`;
  return `${sign}${Math.round(abs)}`;
}

export const InstitutionalFlowChart: React.FC<InstitutionalFlowChartProps> = ({
  symbol,
  history,
}) => {
  const [unit, setUnit] = useState<FlowUnit>('VALUE_CR');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const model = useMemo(() => {
    const valid = history.filter(
      (d) => d.close !== null && d.delivQty !== null && d.delivQty >= 0
    );
    const window30 = valid.slice(-30);
    if (window30.length < 3) return null;

    const avgDelivQty =
      window30.reduce((sum, d) => sum + (d.delivQty ?? 0), 0) / window30.length;

    let cumValCr = 0;
    let cumQty = 0;
    let accumDays = 0;
    let distribDays = 0;

    const rawPoints: FlowPoint[] = window30.map((d, idx) => {
      const close = d.close ?? 0;
      const prevClose =
        idx > 0
          ? (window30[idx - 1].close ?? d.prevClose ?? d.open ?? close)
          : (d.prevClose ?? d.open ?? close);
      const changePct = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;

      const delivQty = d.delivQty ?? 0;
      const delivValueCr = (delivQty * close) / 1e7;
      const delivRatio = avgDelivQty > 0 ? delivQty / avgDelivQty : 1;

      const direction = changePct > 0.05 ? 1 : changePct < -0.05 ? -1 : 0;
      const signedValCr = direction * delivValueCr;
      const signedQty = direction * delivQty;

      cumValCr += signedValCr;
      cumQty += signedQty;

      let zoneType: FlowPoint['zoneType'] = 'NEUTRAL';
      if (direction > 0 && (delivRatio >= 1.2 || (d.delivPer ?? 0) >= 60)) {
        zoneType = 'ACCUMULATION';
        accumDays++;
      } else if (direction < 0 && delivRatio >= 1.2) {
        zoneType = 'DISTRIBUTION';
        distribDays++;
      }

      return {
        date: d.date,
        close,
        changePct,
        delivQty,
        delivPer: d.delivPer,
        delivValueCr,
        delivRatio,
        signedValCr,
        signedQty,
        cumValCr,
        cumQty,
        sma5ValCr: null,
        sma5Qty: null,
        zoneType,
      };
    });

    for (let i = 0; i < rawPoints.length; i++) {
      if (i >= 4) {
        const slice = rawPoints.slice(i - 4, i + 1);
        rawPoints[i].sma5ValCr = slice.reduce((s, p) => s + p.cumValCr, 0) / 5;
        rawPoints[i].sma5Qty = slice.reduce((s, p) => s + p.cumQty, 0) / 5;
      }
    }

    const last = rawPoints[rawPoints.length - 1];
    const fiveAgo = rawPoints[Math.max(0, rawPoints.length - 6)];
    const flow5dValCr = last.cumValCr - fiveAgo.cumValCr;
    const flow5dQty = last.cumQty - fiveAgo.cumQty;

    let regime: 'STRONG_ACCUMULATION' | 'ACCUMULATION' | 'NEUTRAL_FLOW' | 'DISTRIBUTION' =
      'NEUTRAL_FLOW';
    if (last.cumValCr > 0 && flow5dValCr > 0 && accumDays >= distribDays + 2) {
      regime = 'STRONG_ACCUMULATION';
    } else if (last.cumValCr > 0 || (flow5dValCr > 0 && accumDays > distribDays)) {
      regime = 'ACCUMULATION';
    } else if (last.cumValCr < 0 && flow5dValCr < 0) {
      regime = 'DISTRIBUTION';
    }

    return {
      points: rawPoints,
      avgDelivQty,
      accumDays,
      distribDays,
      netCumValCr: last.cumValCr,
      netCumQty: last.cumQty,
      flow5dValCr,
      flow5dQty,
      regime,
    };
  }, [history]);

  const svgGeom = useMemo(() => {
    if (!model) return null;
    const pts = model.points;
    const width = 880;
    const height = 210;
    const padL = 62;
    const padR = 24;
    const padT = 16;
    const padB = 28;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const vals = pts.map((p) => (unit === 'VALUE_CR' ? p.cumValCr : p.cumQty));
    const smas = pts
      .map((p) => (unit === 'VALUE_CR' ? p.sma5ValCr : p.sma5Qty))
      .filter((v): v is number => v !== null);

    const all = [0, ...vals, ...smas];
    const rawMin = Math.min(...all);
    const rawMax = Math.max(...all);
    const pad = Math.max((rawMax - rawMin) * 0.12, unit === 'VALUE_CR' ? 0.5 : 100);
    const minY = rawMin - pad;
    const maxY = rawMax + pad;
    const span = Math.max(maxY - minY, 0.001);

    const xFor = (i: number) =>
      pts.length <= 1 ? padL + plotW / 2 : padL + (i / (pts.length - 1)) * plotW;
    const yFor = (v: number) => padT + (1 - (v - minY) / span) * plotH;

    const zeroY = yFor(0);
    const lineCoords = pts.map((p, i) => {
      const v = unit === 'VALUE_CR' ? p.cumValCr : p.cumQty;
      return `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`;
    });
    const linePath = lineCoords.join(' ');
    const areaPath = `M ${xFor(0).toFixed(1)},${zeroY.toFixed(1)} L ${lineCoords.join(' L ')} L ${xFor(
      pts.length - 1
    ).toFixed(1)},${zeroY.toFixed(1)} Z`;

    const smaPath = pts
      .map((p, i) => {
        const v = unit === 'VALUE_CR' ? p.sma5ValCr : p.sma5Qty;
        return v !== null ? `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}` : null;
      })
      .filter((s): s is string => s !== null)
      .join(' ');

    const sliceW = plotW / Math.max(pts.length - 1, 1);

    return {
      width,
      height,
      padL,
      padR,
      padT,
      padB,
      plotW,
      plotH,
      minY,
      maxY,
      zeroY,
      xFor,
      yFor,
      linePath,
      areaPath,
      smaPath,
      sliceW,
      isNetPositive: vals[vals.length - 1] >= 0,
    };
  }, [model, unit]);

  if (!model || !svgGeom) {
    return null;
  }

  const activePoint =
    model.points[hoverIdx !== null && model.points[hoverIdx] ? hoverIdx : model.points.length - 1];

  const regimeColor =
    model.regime === 'STRONG_ACCUMULATION' || model.regime === 'ACCUMULATION'
      ? 'text-emerald-700'
      : model.regime === 'DISTRIBUTION'
        ? 'text-rose-700'
        : 'text-amber-700';

  const formatYAxis = (v: number) => {
    if (unit === 'VALUE_CR') {
      return `${v >= 0 ? '+' : ''}${v.toFixed(1)}Cr`;
    }
    return formatShares(v);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            {model.netCumValCr >= 0 ? (
              <TrendingUp className="w-4 h-4 text-emerald-700" />
            ) : (
              <TrendingDown className="w-4 h-4 text-rose-700" />
            )}
            30-Day Cumulative Institutional Flow ({symbol})
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Signed delivery-quantity accumulation curve across last {model.points.length} NSE Bhavcopy sessions · Shaded bands mark high-delivery accumulation/distribution days
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md text-xs shrink-0 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setUnit('VALUE_CR')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              unit === 'VALUE_CR'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            ₹ Cr Flow
          </button>
          <button
            type="button"
            onClick={() => setUnit('SHARES')}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              unit === 'SHARES'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Deliv Qty
          </button>
        </div>
      </div>

      {/* Flow Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
          <div className="text-slate-500">Flow Regime</div>
          <div className={`mt-1 font-mono font-bold ${regimeColor}`}>
            {model.regime.replace('_', ' ')}
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            {model.accumDays} Accum · {model.distribDays} Distrib days
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
          <div className="text-slate-500">30D Net Deliv Flow</div>
          <div
            className={`mt-1 font-mono font-bold ${
              model.netCumValCr >= 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {model.netCumValCr >= 0 ? '+' : ''}
            ₹{model.netCumValCr.toFixed(2)} Cr
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            {formatShares(model.netCumQty)} shares
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
          <div className="text-slate-500">5-Session Flow Delta</div>
          <div
            className={`mt-1 font-mono font-bold ${
              model.flow5dValCr >= 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {model.flow5dValCr >= 0 ? '+' : ''}
            ₹{model.flow5dValCr.toFixed(2)} Cr
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            {formatShares(model.flow5dQty)} shares
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200/80 rounded-md p-3">
          <div className="text-slate-500">30D Avg Deliv Qty / Day</div>
          <div className="mt-1 font-mono font-bold text-slate-900">
            {formatShares(model.avgDelivQty).replace(/^\+/, '')}
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            Accum trigger &gt;= 1.2x avg
          </div>
        </div>
      </div>

      {/* Hover Inspection Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200/70 rounded text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3 text-slate-700">
          <span className="font-semibold text-slate-900">{activePoint.date}</span>
          <span>Close ₹{activePoint.close.toFixed(2)}</span>
          <span className={activePoint.changePct >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
            {activePoint.changePct >= 0 ? '+' : ''}
            {activePoint.changePct.toFixed(2)}%
          </span>
          <span className="text-blue-700">
            Deliv {activePoint.delivPer !== null ? `${activePoint.delivPer.toFixed(1)}%` : '—'} (
            {activePoint.delivRatio.toFixed(2)}x avg)
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={activePoint.signedValCr >= 0 ? 'text-emerald-700' : 'text-rose-700'}
          >
            Session:{' '}
            {unit === 'VALUE_CR'
              ? `${activePoint.signedValCr >= 0 ? '+' : ''}₹${activePoint.signedValCr.toFixed(2)} Cr`
              : `${formatShares(activePoint.signedQty)} sh`}
          </span>
          <span className="font-semibold text-slate-900">
            Cum Flow:{' '}
            {unit === 'VALUE_CR'
              ? `${activePoint.cumValCr >= 0 ? '+' : ''}₹${activePoint.cumValCr.toFixed(2)} Cr`
              : `${formatShares(activePoint.cumQty)} sh`}
          </span>
        </div>
      </div>

      {/* Cumulative Flow Line SVG Chart */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgGeom.width} ${svgGeom.height}`}
          className="w-full min-w-[640px] h-auto select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Horizontal grid & Y labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const y = svgGeom.padT + frac * svgGeom.plotH;
            const val = svgGeom.maxY - frac * (svgGeom.maxY - svgGeom.minY);
            return (
              <g key={frac}>
                <line
                  x1={svgGeom.padL}
                  x2={svgGeom.width - svgGeom.padR}
                  y1={y}
                  y2={y}
                  stroke="#E2E8F0"
                  strokeWidth="1"
                />
                <text
                  x={svgGeom.padL - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-slate-400 text-[10px] font-mono"
                >
                  {formatYAxis(val)}
                </text>
              </g>
            );
          })}

          {/* Accumulation & Distribution shaded session zones */}
          {model.points.map((p, i) => {
            if (p.zoneType === 'NEUTRAL') return null;
            const x = svgGeom.xFor(i) - svgGeom.sliceW / 2;
            return (
              <rect
                key={`zone-${p.date}`}
                x={Math.max(svgGeom.padL, x)}
                y={svgGeom.padT}
                width={Math.min(svgGeom.sliceW, svgGeom.width - svgGeom.padR - Math.max(svgGeom.padL, x))}
                height={svgGeom.plotH}
                fill={p.zoneType === 'ACCUMULATION' ? '#10B981' : '#F43F5E'}
                fillOpacity="0.11"
              />
            );
          })}

          {/* Zero baseline */}
          <line
            x1={svgGeom.padL}
            x2={svgGeom.width - svgGeom.padR}
            y1={svgGeom.zeroY}
            y2={svgGeom.zeroY}
            stroke="#94A3B8"
            strokeWidth="1"
            strokeDasharray="4 3"
          />

          {/* Shaded area under cumulative flow */}
          <path
            d={svgGeom.areaPath}
            fill={svgGeom.isNetPositive ? '#10B981' : '#F43F5E'}
            fillOpacity="0.12"
          />

          {/* 5-Session Flow Trend Line */}
          {svgGeom.smaPath && (
            <polyline
              fill="none"
              stroke="#D97706"
              strokeWidth="1.25"
              strokeDasharray="4 3"
              points={svgGeom.smaPath}
            />
          )}

          {/* Main Cumulative Institutional Flow Line */}
          <polyline
            fill="none"
            stroke={svgGeom.isNetPositive ? '#059669' : '#E11D48'}
            strokeWidth="2.25"
            points={svgGeom.linePath}
          />

          {/* Accumulation / Distribution milestone dots */}
          {model.points.map((p, i) => {
            if (p.zoneType === 'NEUTRAL') return null;
            const v = unit === 'VALUE_CR' ? p.cumValCr : p.cumQty;
            return (
              <circle
                key={`dot-${p.date}`}
                cx={svgGeom.xFor(i)}
                cy={svgGeom.yFor(v)}
                r="3"
                fill={p.zoneType === 'ACCUMULATION' ? '#059669' : '#E11D48'}
                stroke="#FFFFFF"
                strokeWidth="1"
              />
            );
          })}

          {/* Hover crosshair */}
          {hoverIdx !== null && model.points[hoverIdx] && (
            <>
              <line
                x1={svgGeom.xFor(hoverIdx)}
                x2={svgGeom.xFor(hoverIdx)}
                y1={svgGeom.padT}
                y2={svgGeom.padT + svgGeom.plotH}
                stroke="#64748B"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle
                cx={svgGeom.xFor(hoverIdx)}
                cy={svgGeom.yFor(
                  unit === 'VALUE_CR'
                    ? model.points[hoverIdx].cumValCr
                    : model.points[hoverIdx].cumQty
                )}
                r="4.5"
                fill="#0F172A"
                stroke="#FFFFFF"
                strokeWidth="1.5"
              />
            </>
          )}

          {/* Invisible hover slices */}
          {model.points.map((p, i) => (
            <rect
              key={`hit-${p.date}`}
              x={svgGeom.xFor(i) - svgGeom.sliceW / 2}
              y={svgGeom.padT}
              width={svgGeom.sliceW}
              height={svgGeom.plotH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          ))}

          {/* X-axis dates */}
          {[0, Math.floor(model.points.length / 2), model.points.length - 1].map((idx) => {
            const p = model.points[idx];
            if (!p) return null;
            return (
              <text
                key={`x-${idx}`}
                x={svgGeom.xFor(idx)}
                y={svgGeom.height - 8}
                textAnchor="middle"
                className="fill-slate-400 text-[10px] font-mono"
              >
                {p.date}
              </text>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-5 text-[11px] text-slate-500">
        <span className={svgGeom.isNetPositive ? 'text-emerald-700 font-medium' : 'text-rose-700 font-medium'}>
          Solid Line: 30D Cumulative Institutional Delivery Flow
        </span>
        <span className="text-amber-700">Amber dashed: 5-Session Flow Trend</span>
        <span className="text-emerald-700">Green Zone / Dots: High-Delivery Accumulation (&gt;=1.2x avg DelivQty on Up Close)</span>
        <span className="text-rose-700">Red Zone / Dots: High-Delivery Distribution</span>
      </div>
    </div>
  );
};
