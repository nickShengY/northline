import React from 'react';
import { clsx } from 'clsx';

export interface StatusIndicatorProps {
  status: 'online' | 'offline' | 'syncing' | 'error' | 'warning' | 'idle';
  label?: string;
  pulse?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<string, { color: string; bgColor: string }> = {
  online: { color: 'var(--success)', bgColor: 'color-mix(in srgb, var(--success) 15%, transparent)' },
  offline: { color: 'var(--ink-muted)', bgColor: 'color-mix(in srgb, var(--ink-muted) 15%, transparent)' },
  syncing: { color: 'var(--accent-cyan)', bgColor: 'color-mix(in srgb, var(--accent-cyan) 15%, transparent)' },
  error: { color: 'var(--danger)', bgColor: 'color-mix(in srgb, var(--danger) 15%, transparent)' },
  warning: { color: 'var(--warning)', bgColor: 'color-mix(in srgb, var(--warning) 15%, transparent)' },
  idle: { color: 'var(--ink-muted)', bgColor: 'color-mix(in srgb, var(--ink-muted) 10%, transparent)' },
};

const sizeConfig: Record<string, { dot: string; text: string }> = {
  sm: { dot: 'w-2 h-2', text: 'text-xs' },
  md: { dot: 'w-2.5 h-2.5', text: 'text-sm' },
  lg: { dot: 'w-3 h-3', text: 'text-base' },
};

const defaultStatusConfig = { color: 'var(--ink-muted)', bgColor: 'color-mix(in srgb, var(--ink-muted) 10%, transparent)' };
const defaultSizeConfig = { dot: 'w-2.5 h-2.5', text: 'text-sm' };

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  label,
  pulse = true,
  size = 'md',
}) => {
  const config = statusConfig[status] ?? defaultStatusConfig;
  const sizes = sizeConfig[size] ?? defaultSizeConfig;

  return (
    <div role="status" aria-label={label ? undefined : `Status: ${status}`} className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={clsx(
          'rounded-full',
          sizes.dot,
          pulse && status === 'syncing' && 'animate-pulse',
          pulse && status === 'online' && 'animate-pulse'
        )}
        style={{
          backgroundColor: config.color,
          boxShadow: `0 0 8px ${config.color}`,
        }}
      />
      {label && (
        <span
          className={clsx(sizes.text, 'font-medium')}
          style={{ color: config.color }}
        >
          {label}
        </span>
      )}
    </div>
  );
};

// Connection Status - specialized for network/offline state
export interface ConnectionStatusProps {
  connected: boolean;
  lastSync?: Date;
  pendingEvents?: number;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  connected,
  lastSync,
  pendingEvents = 0,
}) => {
  const status = connected ? 'online' : 'offline';
  const config = statusConfig[status] ?? defaultStatusConfig;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)]"
      style={{ backgroundColor: config.bgColor }}
    >
      <StatusIndicator status={status} size="sm" pulse={connected} />
      <div className="flex flex-col">
        <span
          className="text-sm font-medium"
          style={{ color: config.color }}
        >
          {connected ? 'Connected' : 'Offline'}
        </span>
        {lastSync && (
          <span className="text-xs text-[var(--ink-muted)]">
            Last sync: {formatTimeAgo(lastSync)}
          </span>
        )}
      </div>
      {pendingEvents > 0 && (
        <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--warning)]/20 text-[var(--warning)]">
          {pendingEvents} pending
        </span>
      )}
    </div>
  );
};

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default StatusIndicator;
