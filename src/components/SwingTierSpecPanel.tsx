import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, HelpCircle, XCircle } from 'lucide-react';
import type { ScreenerRow } from '../types/trading';

interface SwingTierSpecPanelProps {
  defaultOpen?: boolean;
  compactToggleLabel?: string;
  activeStock?: ScreenerRow | null;
}

export const SwingTierSpecPanel: React.FC<SwingTierSpecPanelProps> = ({
  defaultOpen = false,
  compactToggleLabel = 'T1 / T2 / T3 Specification (T1 & T2 kya hai?)',
  activeStock = null,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  const isDelivAB = activeStock
    ? activeStock.deliveryCategory === 'A_AND_B' ||
      activeStock.deliveryCategory === 'A_ONLY' ||
      activeStock.deliveryCategory === 'B_ONLY'
    : false;
  const passLiq = activeStock ? activeStock.liquidityPass : null;
  const passDelivAB = activeStock ? isDelivAB : null;
  const passEma21 = activeStock ? activeStock.aboveEma21 === true : null;
  const passDelivRatio = activeStock
    ? (activeStock.delivQtyRatio ?? 0) >= 1.2
    : null;
  const passRvol = activeStock ? activeStock.rvolBand === 'HIGH' : null;
  const passGreen = activeStock ? (activeStock.changePct ?? 0) > 0 : null;
  const passRsi = activeStock
    ? activeStock.rsi14 !== null &&
      activeStock.rsi14 >= 45 &&
      activeStock.rsi14 <= 78
    : null;

  const GateMark = ({ pass }: { pass: boolean | null }) => {
    if (pass === null) return null;
    return pass ? (
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
    ) : (
      <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
            <HelpCircle className="w-3.5 h-3.5 text-blue-700 shrink-0" />
            {compactToggleLabel}
          </span>
          <span className="text-slate-400 hidden sm:inline">·</span>
          <span className="text-[11px] text-slate-600 font-mono">
            <span className="text-emerald-700 font-semibold">T1</span> = Breakout Ready ·{' '}
            <span className="text-blue-700 font-semibold">T2</span> = Accumulation Watch ·{' '}
            <span className="text-amber-700 font-semibold">T3</span> = High RVOL Mover
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 shrink-0">
          {open ? 'Hide Spec' : 'View Rules'}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-3 border-t border-slate-100 space-y-3 text-xs">
          {activeStock && (
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-slate-800">
                <span className="font-semibold">{activeStock.symbol}</span> Active Tier:{' '}
                <span
                  className={
                    activeStock.swingTier === 'TIER_1_READY'
                      ? 'font-bold text-emerald-700'
                      : activeStock.swingTier === 'TIER_2_ACCUMULATION'
                        ? 'font-bold text-blue-700'
                        : activeStock.swingTier === 'TIER_3_RVOL_WATCH'
                          ? 'font-bold text-amber-700'
                          : 'font-semibold text-slate-500'
                  }
                >
                  {activeStock.swingTier}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-600 tabular-nums">
                <span className="inline-flex items-center gap-1">
                  <GateMark pass={passLiq} /> Liq &gt;=1.5Cr
                </span>
                <span className="inline-flex items-center gap-1">
                  <GateMark pass={passDelivAB} /> Deliv A/B ({activeStock.deliveryCategory})
                </span>
                <span className="inline-flex items-center gap-1">
                  <GateMark pass={passEma21} /> Above EMA21
                </span>
                <span className="inline-flex items-center gap-1">
                  <GateMark pass={passDelivRatio} /> DelivQty &gt;=1.2x (
                  {activeStock.delivQtyRatio !== null
                    ? `${activeStock.delivQtyRatio.toFixed(2)}x`
                    : '—'}
                  )
                </span>
                <span className="inline-flex items-center gap-1">
                  <GateMark pass={passRvol} /> RVOL &gt;1.5x (
                  {activeStock.rvol !== null ? `${activeStock.rvol.toFixed(2)}x` : 'WAIT'})
                </span>
                <span className="inline-flex items-center gap-1">
                  <GateMark pass={passGreen} /> Close +ve
                </span>
                <span className="inline-flex items-center gap-1">
                  <GateMark pass={passRsi} /> RSI 45–78 (
                  {activeStock.rsi14 !== null ? activeStock.rsi14.toFixed(1) : '—'})
                </span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* T1 Spec */}
            <div className="p-3.5 rounded-md border border-emerald-200 bg-emerald-50/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-emerald-800">
                  T1 · TIER_1_READY
                </span>
                <span className="text-[11px] font-semibold text-emerald-700">
                  Highest Priority Entry
                </span>
              </div>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                <strong>Matlab:</strong> Institutional delivery accumulation bhi ho chuki hai AUR aaj volume breakout + green candle + momentum confirm ho gaya hai. Sabse strong swing setup.
              </p>
              <ul className="space-y-1 text-[11px] font-mono text-slate-700 list-disc list-inside tabular-nums">
                <li>20D Avg Turnover &gt;= ₹1.5 Cr (Liquid)</li>
                <li>30D Delivery A OR B qualified</li>
                <li>Price &gt; 21-Session EMA (Uptrend)</li>
                <li>DelivQty Ratio &gt;= 1.20x (Smart-money buy)</li>
                <li>20D RVOL &gt; 1.50x (Volume surge)</li>
                <li>EOD Change % &gt; 0% (Green close)</li>
                <li>RSI(14) between 45.0 and 78.0</li>
              </ul>
            </div>

            {/* T2 Spec */}
            <div className="p-3.5 rounded-md border border-blue-200 bg-blue-50/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-blue-800">
                  T2 · TIER_2_ACCUMULATION
                </span>
                <span className="text-[11px] font-semibold text-blue-700">
                  Pre-Breakout Watch
                </span>
              </div>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                <strong>Matlab:</strong> Silent institutional buying chal rahi hai (Delivery A/B + EMA21 ke upar + DelivQty expansion), bas abhi RVOL &gt; 1.5x breakout candle aana baaki hai.
              </p>
              <ul className="space-y-1 text-[11px] font-mono text-slate-700 list-disc list-inside tabular-nums">
                <li>20D Avg Turnover &gt;= ₹1.5 Cr (Liquid)</li>
                <li>30D Delivery A OR B qualified</li>
                <li>Price &gt; 21-Session EMA (Uptrend)</li>
                <li>DelivQty Ratio &gt;= 1.20x (Accumulation)</li>
                <li className="text-slate-500">
                  Waiting for: RVOL &gt; 1.5x / Green / RSI trigger → becomes T1
                </li>
              </ul>
            </div>

            {/* T3 Spec */}
            <div className="p-3.5 rounded-md border border-amber-200 bg-amber-50/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-amber-800">
                  T3 · TIER_3_RVOL_WATCH
                </span>
                <span className="text-[11px] font-semibold text-amber-700">
                  Early Volume Spike
                </span>
              </div>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                <strong>Matlab:</strong> Aaj high volume ke saath green move aaya hai, lekin abhi 30D Delivery A/B ya EMA21 trend confirm nahi hua hai. Radar par rakhen.
              </p>
              <ul className="space-y-1 text-[11px] font-mono text-slate-700 list-disc list-inside tabular-nums">
                <li>20D Avg Turnover &gt;= ₹1.5 Cr (Liquid)</li>
                <li>20D RVOL &gt; 1.50x (Volume surge)</li>
                <li>EOD Change % &gt; 0% (Green close)</li>
                <li className="text-slate-500">
                  Missing: 30D Delivery A/B or Price &gt; EMA21
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-600 flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Selection Flow:</strong> Pehle <strong>T1</strong> (Ready) ya{' '}
              <strong>T2</strong> (Accumulation) filter karo → 3M Result Gate &amp; Fundamental Audit (&gt;=4/7) check karo → Stock Detail me U-Turn Zone &amp; ATR Stop dekho.
            </span>
            <span className="font-mono text-slate-500">
              Delivery A = 5D Avg &gt;= 60% · Delivery B = Day Deliv &gt;= 60% (5+ sessions)
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
