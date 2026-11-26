import type { MarketCapCategory } from '../types/trading';

export function getCapLabel(category: MarketCapCategory | undefined | null): string {
  switch (category) {
    case 'LARGE_CAP':
      return 'Large Cap';
    case 'MID_CAP':
      return 'Mid Cap';
    case 'SMALL_CAP':
      return 'Small Cap';
    default:
      return '';
  }
}

export function getCapShortLabel(category: MarketCapCategory | undefined | null): string {
  switch (category) {
    case 'LARGE_CAP':
      return 'Large';
    case 'MID_CAP':
      return 'Mid';
    case 'SMALL_CAP':
      return 'Small';
    default:
      return '';
  }
}

export function getCapBadgeClass(category: MarketCapCategory | undefined | null): string {
  switch (category) {
    case 'LARGE_CAP':
      return 'border-indigo-200 bg-indigo-50 text-indigo-700';
    case 'MID_CAP':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    case 'SMALL_CAP':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-500';
  }
}

export function formatMarketCapCr(mcapCr: number | null | undefined): string {
  if (mcapCr === null || mcapCr === undefined || !Number.isFinite(mcapCr) || mcapCr <= 0) {
    return '—';
  }
  return `₹${mcapCr.toLocaleString('en-IN')} Cr`;
}
