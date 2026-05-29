import React from 'react';
import { clsx } from 'clsx';

export interface StatusIndicatorProps {
  status: 'online' | 'offline' | 'syncing' | 'error' | 'warning' | 'idle';
  label?: string;
  pulse?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<string, { color: string; bgColor: string }> = {
  online: { color: 'var(--success)', bgColor: 'rgba(16, 185, 129, 0.15)' },
  offline: { color: 'var(--ink-muted)', bgColor: 'rgba(100, 116, 139, 0.15)' },
  syncing: { color: 'var(--accent-cyan)', bgColor: 'rgba(0, 212, 255, 0.15)' },
  error: { color: 'var(--danger)', bgColor: 'rgba(239, 68, 68, 0.15)' },
  warning: { color: 'var(--warning)', bgColor: 'rgba(245, 158, 11, 0.15)' },
  idle: { color: 'var(--ink-muted)', bgColor: 'rgba(100, 116, 139, 0.1)' },
};

const sizeConfig: Record<string, { dot: string; text: string }> = {
  sm: { dot: 'w-2 h-2', text: 'text-xs' },
  md: { dot: 'w-2.5 h-2.5', text: 'text-sm' },
  lg: { dot: 'w-3 h-3', text: 'text-base' },
};

const defaultStatusConfig = { color: 'var(--ink-muted)', bgColor: 'rgba(100, 116, 139, 0.1)' };
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
    <div className="inline-flex items-center gap-2">
      <span
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
