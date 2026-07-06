import React from 'react';
import { clsx } from 'clsx';
import { Spinner } from './Spinner';

export type SyncState = 'synced' | 'syncing' | 'pending' | 'error' | 'offline';

export interface SyncIndicatorProps {
  state: SyncState;
  lastSync?: Date;
  pendingCount?: number;
  error?: string;
  onRetry?: () => void;
  compact?: boolean;
}

const stateConfig: Record<SyncState, { label: string; color: string; icon: React.ReactNode }> = {
  synced: {
    label: 'Synced',
    color: 'var(--success)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  syncing: {
    label: 'Syncing',
    color: 'var(--accent-cyan)',
    icon: null, // Uses spinner
  },
  pending: {
    label: 'Pending',
    color: 'var(--warning)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  error: {
    label: 'Sync Error',
    color: 'var(--danger)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  offline: {
    label: 'Offline',
    color: 'var(--ink-muted)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
      </svg>
    ),
  },
};

export const SyncIndicator: React.FC<SyncIndicatorProps> = ({
  state,
  lastSync,
  pendingCount = 0,
  error,
  onRetry,
  compact = false,
}) => {
  const config = stateConfig[state];

  if (compact) {
    return (
      <div
        role="status"
        className={clsx(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
          'border transition-all duration-[var(--transition-base)]'
        )}
        style={{
          color: config.color,
          borderColor: config.color,
          backgroundColor: `color-mix(in srgb, ${config.color} 10%, transparent)`,
        }}
      >
        {state === 'syncing' ? (
          <Spinner size="sm" variant="cyan" />
        ) : (
          config.icon
        )}
        <span>{config.label}</span>
        {pendingCount > 0 && state !== 'synced' && (
          <span className="opacity-75">({pendingCount})</span>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      className={clsx(
        'flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)]',
        'border backdrop-blur-sm transition-all duration-[var(--transition-base)]'
      )}
      style={{
        borderColor: `color-mix(in srgb, ${config.color} 25%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${config.color} 6%, transparent)`,
      }}
    >
      <div className="flex items-center justify-center w-8 h-8 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${config.color} 12%, transparent)` }}>
        {state === 'syncing' ? (
          <Spinner size="sm" variant="cyan" />
        ) : (
          <span style={{ color: config.color }}>{config.icon}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium" style={{ color: config.color }}>
            {config.label}
          </span>
          {pendingCount > 0 && state !== 'synced' && (
            <span className="px-1.5 py-0.5 text-xs rounded bg-[var(--warning)]/20 text-[var(--warning)]">
              {pendingCount} pending
            </span>
          )}
        </div>
        {lastSync && state === 'synced' && (
          <p className="text-xs text-[var(--ink-muted)] mt-0.5">
            Last synced {formatRelativeTime(lastSync)}
          </p>
        )}
        {error && state === 'error' && (
          <p className="text-xs text-[var(--danger)] mt-0.5 truncate">{error}</p>
        )}
      </div>

      {state === 'error' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30 transition-all"
        >
          Retry
        </button>
      )}
    </div>
  );
};

// Sync Progress Bar
export interface SyncProgressProps {
  progress: number; // 0-100
  currentItem?: string;
  total?: number;
  current?: number;
}

export const SyncProgress: React.FC<SyncProgressProps> = ({
  progress,
  currentItem,
  total,
  current,
}) => {
  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--ink-secondary)]">Syncing...</span>
        <span className="text-[var(--accent-cyan)]">{Math.round(progress)}%</span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Sync progress"
        className="h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-teal)] transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {currentItem && (
        <p className="text-xs text-[var(--ink-muted)] truncate">
          {currentItem}
          {total != null && current != null ? ` (${current}/${total})` : ''}
        </p>
      )}
    </div>
  );
};

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default SyncIndicator;
