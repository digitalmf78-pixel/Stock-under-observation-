import React, { useEffect, useState } from 'react';
import { Bell, BellRing, CheckCircle2, RotateCcw, Trash2, TrendingDown, TrendingUp, X } from 'lucide-react';
import {
  createPriceAlert,
  deletePriceAlert,
  loadPriceAlerts,
  PRICE_ALERTS_STORAGE_KEY,
  PRICE_ALERTS_UPDATED_EVENT,
  rearmPriceAlert,
  type PriceAlertCondition,
  type PriceAlertRule,
} from '../utils/priceAlerts';

interface PriceAlertPanelProps {
  symbol: string;
  currentPrice: number;
  suggestedStopLoss: number | null;
  onClose: () => void;
}

export const PriceAlertPanel: React.FC<PriceAlertPanelProps> = ({
  symbol,
  currentPrice,
  suggestedStopLoss,
  onClose,
}) => {
  const [targetInput, setTargetInput] = useState<string>(() =>
    (currentPrice * 1.03).toFixed(2)
  );
  const [condition, setCondition] = useState<PriceAlertCondition>('ABOVE_OR_EQUAL');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<PriceAlertRule[]>(() =>
    loadPriceAlerts().filter((a) => a.symbol === symbol.toUpperCase())
  );

  useEffect(() => {
    setTargetInput((currentPrice * 1.03).toFixed(2));
    setCondition('ABOVE_OR_EQUAL');
    setFormError(null);
  }, [symbol, currentPrice]);

  useEffect(() => {
    const refresh = () => {
      setAlerts(loadPriceAlerts().filter((a) => a.symbol === symbol.toUpperCase()));
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === PRICE_ALERTS_STORAGE_KEY) refresh();
    };
    refresh();
    window.addEventListener(PRICE_ALERTS_UPDATED_EVENT, refresh);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(PRICE_ALERTS_UPDATED_EVENT, refresh);
      window.removeEventListener('storage', handleStorage);
    };
  }, [symbol]);

  const applyTargetPreset = (price: number, cond: PriceAlertCondition) => {
    setTargetInput(price.toFixed(2));
    setCondition(cond);
    setFormError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(targetInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFormError('Enter a valid positive target price in INR.');
      return;
    }
    setFormError(null);
    createPriceAlert({
      symbol,
      targetPrice: parsed,
      condition,
      referencePriceAtCreation: currentPrice,
      note,
    });
    setNote('');
  };

  return (
    <section
      aria-label="Set Price Alert"
      className="bg-white border border-amber-200 rounded-lg p-5 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <BellRing className="w-4 h-4 text-amber-600" />
            <span>Price Alerts for {symbol}</span>
            <span className="text-xs font-mono font-normal text-slate-500">
              Current Ref: ₹{currentPrice.toFixed(2)}
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Saved in browser localStorage. A toast notification pops up immediately whenever live or scanned price crosses your threshold.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close price alert panel"
          className="p-1.5 text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <div className="md:col-span-3">
          <label
            htmlFor="price-alert-condition"
            className="block text-[11px] font-medium text-slate-600 mb-1"
          >
            Trigger Condition
          </label>
          <select
            id="price-alert-condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value as PriceAlertCondition)}
            className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
          >
            <option value="ABOVE_OR_EQUAL">Crosses Above (≥ Target)</option>
            <option value="BELOW_OR_EQUAL">Crosses Below (≤ Target)</option>
          </select>
        </div>

        <div className="md:col-span-3">
          <label
            htmlFor="price-alert-target"
            className="block text-[11px] font-medium text-slate-600 mb-1"
          >
            Target Price (₹)
          </label>
          <input
            id="price-alert-target"
            type="number"
            step="0.05"
            min="0.05"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            placeholder="e.g. 1250.00"
            className="w-full min-h-[38px] px-3 py-1.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
          />
        </div>

        <div className="md:col-span-4">
          <label
            htmlFor="price-alert-note"
            className="block text-[11px] font-medium text-slate-600 mb-1"
          >
            Note (Optional)
          </label>
          <input
            id="price-alert-note"
            type="text"
            maxLength={80}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. 35D breakout / 1.5x ATR stop"
            className="w-full min-h-[38px] px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="submit"
            className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors whitespace-nowrap"
          >
            <Bell className="w-3.5 h-3.5" />
            Save Alert
          </button>
        </div>
      </form>

      {/* Quick Target Presets */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-slate-500 font-medium">Quick Targets:</span>
        <button
          type="button"
          onClick={() => applyTargetPreset(currentPrice * 1.03, 'ABOVE_OR_EQUAL')}
          className="px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-mono transition-colors"
        >
          +3% (₹{(currentPrice * 1.03).toFixed(2)})
        </button>
        <button
          type="button"
          onClick={() => applyTargetPreset(currentPrice * 1.05, 'ABOVE_OR_EQUAL')}
          className="px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-mono transition-colors"
        >
          +5% (₹{(currentPrice * 1.05).toFixed(2)})
        </button>
        <button
          type="button"
          onClick={() => applyTargetPreset(currentPrice * 0.97, 'BELOW_OR_EQUAL')}
          className="px-2 py-1 rounded border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 font-mono transition-colors"
        >
          -3% (₹{(currentPrice * 0.97).toFixed(2)})
        </button>
        {suggestedStopLoss !== null && suggestedStopLoss > 0 && (
          <button
            type="button"
            onClick={() => applyTargetPreset(suggestedStopLoss, 'BELOW_OR_EQUAL')}
            className="px-2 py-1 rounded border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 font-mono transition-colors"
          >
            1.5× ATR Stop (₹{suggestedStopLoss.toFixed(2)})
          </button>
        )}
      </div>

      {formError && (
        <div className="text-xs text-rose-700 font-medium">{formError}</div>
      )}

      {/* Existing Alerts List for Symbol */}
      {alerts.length > 0 && (
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 font-mono">
            Saved Alerts for {symbol} ({alerts.length})
          </div>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
            {alerts.map((rule) => {
              const isTriggered = rule.triggeredAt !== null;
              const isAbove = rule.condition === 'ABOVE_OR_EQUAL';

              return (
                <div
                  key={rule.id}
                  className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] font-semibold border ${
                        isTriggered
                          ? 'bg-amber-50 text-amber-900 border-amber-300'
                          : isAbove
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-rose-50 text-rose-800 border-rose-200'
                      }`}
                    >
                      {isAbove ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      {isAbove ? '≥' : '≤'} ₹{rule.targetPrice.toFixed(2)}
                    </span>

                    {isTriggered ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-mono text-[11px] font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Triggered @ ₹{(rule.triggeredPrice ?? rule.targetPrice).toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-slate-500 font-mono text-[11px]">
                        Armed (set @ ₹{rule.referencePriceAtCreation.toFixed(2)})
                      </span>
                    )}

                    {rule.note && <span className="text-slate-600">{rule.note}</span>}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isTriggered && (
                      <button
                        type="button"
                        onClick={() => rearmPriceAlert(rule.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Re-arm
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deletePriceAlert(rule.id)}
                      aria-label={`Delete alert at ₹${rule.targetPrice.toFixed(2)}`}
                      className="p-1 text-slate-400 hover:text-rose-700 rounded transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
