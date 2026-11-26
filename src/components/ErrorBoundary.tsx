import React from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  onRetry?: () => void | Promise<void>;
  onNavigateHome?: () => void;
  resetKeys?: unknown[];
  externalError?: string | Error | null;
  contextLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  retryAttempt: number;
  retrying: boolean;
  showDetails: boolean;
}

function areResetKeysEqual(a?: unknown[], b?: unknown[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryAttempt: 0,
      retrying: false,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[GlobalErrorBoundary]', error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      !areResetKeysEqual(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        retrying: false,
        showDetails: false,
      });
    }
  }

  handleRetry = async (): Promise<void> => {
    if (this.state.retrying) return;
    this.setState({ retrying: true });
    try {
      if (this.props.onRetry) {
        await this.props.onRetry();
      }
    } finally {
      this.setState((prev) => ({
        hasError: false,
        error: null,
        errorInfo: null,
        retrying: false,
        showDetails: false,
        retryAttempt: prev.retryAttempt + 1,
      }));
    }
  };

  handleNavigateHome = (): void => {
    this.setState(
      (prev) => ({
        hasError: false,
        error: null,
        errorInfo: null,
        retrying: false,
        showDetails: false,
        retryAttempt: prev.retryAttempt + 1,
      }),
      () => {
        this.props.onNavigateHome?.();
      }
    );
  };

  render(): React.ReactNode {
    const { externalError, contextLabel, onNavigateHome } = this.props;
    const { hasError, error, errorInfo, retrying, retryAttempt, showDetails } = this.state;

    const resolvedExternalMessage =
      externalError instanceof Error
        ? externalError.message
        : typeof externalError === 'string' && externalError.trim()
          ? externalError
          : null;

    const activeErrorMessage = hasError
      ? error?.message || 'An unexpected rendering or runtime error occurred.'
      : resolvedExternalMessage;

    if (hasError || resolvedExternalMessage) {
      return (
        <div
          role="alert"
          className="bg-white border border-rose-200 rounded-lg shadow-sm overflow-hidden max-w-2xl mx-auto my-8"
        >
          <div className="px-5 py-4 bg-rose-50/80 border-b border-rose-200 flex items-start gap-3">
            <div className="p-2 bg-white border border-rose-200 rounded-md shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-slate-900">
                {hasError ? 'Something went wrong loading this view' : 'Data fetch error'}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                {contextLabel
                  ? `Section: ${contextLabel}. `
                  : ''}
                A transient API failure or unexpected runtime state prevented this section from loading. Click Retry to reset data-fetching state and reload.
              </p>
            </div>
          </div>

          <div className="p-5 space-y-4 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md font-mono text-rose-800 break-words">
              {activeErrorMessage}
            </div>

            {hasError && (error?.stack || errorInfo?.componentStack) && (
              <div>
                <button
                  type="button"
                  onClick={() => this.setState((s) => ({ showDetails: !s.showDetails }))}
                  className="text-[11px] font-medium text-slate-600 hover:text-slate-900 underline"
                >
                  {showDetails ? 'Hide technical details' : 'Show technical details'}
                </button>
                {showDetails && (
                  <pre className="mt-2 p-3 bg-slate-900 text-slate-200 rounded-md text-[11px] font-mono overflow-x-auto max-h-48 leading-relaxed">
                    {error?.stack || ''}
                    {errorInfo?.componentStack ? `\nComponent Stack:${errorInfo.componentStack}` : ''}
                  </pre>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => void this.handleRetry()}
                disabled={retrying}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-md transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
                {retrying ? 'Retrying & Reloading...' : 'Retry'}
              </button>

              {onNavigateHome && (
                <button
                  type="button"
                  onClick={this.handleNavigateHome}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition-colors"
                >
                  <Home className="w-3.5 h-3.5" />
                  Back to Pipeline Overview
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return <React.Fragment key={retryAttempt}>{this.props.children}</React.Fragment>;
  }
}
