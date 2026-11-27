import React, { useEffect, useState } from 'react';
import { KeyRound, Lock, ShieldCheck, X } from 'lucide-react';
import {
  closeAuthModal,
  loginAdminPasscode,
  setupAdminPasscode,
  type ClientAuthState,
} from '../utils/authClient';

interface AdminAuthModalProps {
  authState: ClientAuthState;
}

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({ authState }) => {
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authState.modalOpen) {
      setError(null);
      setPasscode('');
      setConfirmPasscode('');
    }
  }, [authState.modalOpen, authState.needsSetup]);

  if (!authState.modalOpen) return null;

  const isSetup = authState.needsSetup;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = passcode.trim();
    if (isSetup) {
      if (trimmed.length < 6) {
        setError('Passcode must be at least 6 characters.');
        return;
      }
      if (trimmed !== confirmPasscode.trim()) {
        setError('Passcodes do not match.');
        return;
      }
    } else if (!trimmed) {
      setError('Enter your admin passcode.');
      return;
    }

    setSubmitting(true);
    try {
      if (isSetup) {
        await setupAdminPasscode(trimmed);
      } else {
        await loginAdminPasscode(trimmed);
      }
    } catch (err) {
      setError((err as Error).message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-auth-title"
    >
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            {isSetup ? (
              <KeyRound className="w-4 h-4 text-blue-700" />
            ) : (
              <Lock className="w-4 h-4 text-blue-700" />
            )}
            <h2 id="admin-auth-title" className="text-sm font-semibold text-slate-900">
              {isSetup ? 'Claim Admin Workspace Passcode' : 'Unlock Admin Controls'}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeAuthModal}
            aria-label="Close authentication modal"
            className="p-1 text-slate-500 hover:text-slate-900 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed">
            {isSetup
              ? 'First-run security setup: choose an admin passcode (6+ characters) to protect Bhavcopy reloads, fundamental writes, watchlist edits, and paper trades. Sessions stay in memory only.'
              : authState.configuredSource === 'env'
                ? 'Enter the ADMIN_PASSCODE configured in environment secrets to authorize write actions. Sessions stay in memory only.'
                : 'Enter your claimed admin passcode to authorize write actions for this browser session.'}
          </p>

          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-800">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="admin-passcode-input" className="block font-medium text-slate-700">
              {isSetup ? 'New Admin Passcode' : 'Admin Passcode'}
            </label>
            <input
              id="admin-passcode-input"
              type="password"
              autoFocus
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder={isSetup ? 'Minimum 6 characters' : 'Enter admin passcode'}
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          {isSetup && (
            <div className="space-y-1">
              <label
                htmlFor="admin-passcode-confirm"
                className="block font-medium text-slate-700"
              >
                Confirm Passcode
              </label>
              <input
                id="admin-passcode-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value)}
                placeholder="Re-enter passcode"
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={closeAuthModal}
              className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-medium"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {submitting
                ? 'Verifying...'
                : isSetup
                  ? 'Set Passcode & Unlock'
                  : 'Unlock Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
