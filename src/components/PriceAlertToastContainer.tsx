import React, { useEffect, useState } from 'react';
import { ArrowUpRight, BellRing, RotateCcw, TrendingDown, TrendingUp, X } from 'lucide-react';
import {
  dismissPriceAlertToast,
  loadPriceAlerts,
  PRICE_ALERTS_STORAGE_KEY,
  PRICE_ALERTS_UPDATED_EVENT,
  rearmPriceAlert,
  type PriceAlertRule,
} from '../utils/priceAlerts';

interface PriceAlertToastContainerProps {
  onSelectSymbol?: (symbol: string) => void;
}

export const PriceAlertToastContainer: React.FC<PriceAlertToastContainerProps> = ({
  onSelectSymbol,
}) => {
  const [triggeredToasts, setTriggeredToasts] = useState<PriceAlertRule[]>(() =>
    loadPriceAlerts().filter((a) => a.triggeredAt !== null && !a.dismissed)
  );

  useEffect(() => {
    const syncFromStorage = () => {
      const next = loadPriceAlerts().filter((a) => a.triggeredAt !== null && !a.dismissed);
      setTriggeredToasts(next);
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === PRICE_ALERTS_STORAGE_KEY) {
        syncFromStorage();
      }
    };

    window.addEventListener(PRICE_ALERTS_UPDATED_EVENT, syncFromStorage);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(PRICE_ALERTS_UPDATED_EVENT, syncFromStorage);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  if (triggeredToasts.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Triggered price alert notifications"
      className="fixed bottom-16 lg:bottom-5 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
    >
      {triggeredToasts.slice(0, 4).map((alert) => {
        const isBullishBreakout = alert.condition === 'ABOVE_OR_EQUAL';
        const triggeredPrice = alert.triggeredPrice ?? alert.targetPrice;

        return (
          <div
            key={alert.id}
            className={`pointer-events-auto bg-white border rounded-lg shadow-lg p-3.5 transition-all ${
              isBullishBreakout
                ? 'border-emerald-300 border-l-4 border-l-emerald-600'
                : 'border-rose-300 border-l-4 border-l-rose-600'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className={`p-1.5 rounded-md shrink-0 mt-0.5 ${
                    isBullishBreakout
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-rose-50 text-rose-700'
                  }`}
                >
                  {isBullishBreakout ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wide font-semibold text-slate-500">
                      <BellRing className="w-3 h-3 text-amber-600" />
                      Price Alert Triggered
                    </span>
                  </div>

                  <div className="mt-0.5 text-sm font-bold font-mono text-slate-900 flex items-center gap-2">
                    <span>{alert.symbol}</span>
                    <span
                      className={`text-xs font-semibold ${
                        isBullishBreakout ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      ₹{triggeredPrice.toFixed(2)}
                    </span>
                  </div>

                  <div className="mt-0.5 text-xs text-slate-600 font-mono tabular-nums">
                    Crossed {isBullishBreakout ? 'above ≥' : 'below ≤'} ₹
                    {alert.targetPrice.toFixed(2)}
                  </div>

                  {alert.note && (
                    <div className="mt-1 text-[11px] text-slate-500 truncate">{alert.note}</div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {onSelectSymbol && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectSymbol(alert.symbol);
                          dismissPriceAlertToast(alert.id);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-slate-900 hover:bg-slate-800 text-white rounded transition-colors whitespace-nowrap"
                      >
                        <span>View Chart</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => rearmPriceAlert(alert.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors whitespace-nowrap"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Re-arm</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissPriceAlertToast(alert.id)}
                      className="px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 transition-colors whitespace-nowrap"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => dismissPriceAlertToast(alert.id)}
                aria-label={`Dismiss ${alert.symbol} price alert`}
                className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
