import React from 'react';
import { clsx } from 'clsx';
import type { Size } from '../tokens';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'cyan' | 'teal' | 'purple';
  size?: Size;
  dot?: boolean;
  pulse?: boolean;
}

const variantClasses: Record<string, string> = {
  default: 'bg-[var(--bg-glass)] text-[var(--ink-secondary)] border-[var(--border-default)]',
  success: 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30',
  warning: 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30',
  danger: 'bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/30',
  info: 'bg-[var(--info)]/15 text-[var(--info)] border-[var(--info)]/30',
  cyan: 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)] border-[var(--accent-cyan)]/30',
  teal: 'bg-[var(--accent-teal)]/15 text-[var(--accent-teal)] border-[var(--accent-teal)]/30',
  purple: 'bg-[var(--accent-purple)]/15 text-[var(--accent-purple)] border-[var(--accent-purple)]/30',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
  lg: 'px-3 py-1.5 text-base',
  xl: 'px-4 py-2 text-lg',
};

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'default',
  size = 'md',
  dot = false,
  pulse = false,
  children,
  ...props
}) => {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full font-medium border transition-all duration-[var(--transition-fast)]',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={clsx(
            'w-2 h-2 rounded-full',
            variant === 'success' && 'bg-[var(--success)]',
            variant === 'warning' && 'bg-[var(--warning)]',
            variant === 'danger' && 'bg-[var(--danger)]',
            variant === 'info' && 'bg-[var(--info)]',
            variant === 'cyan' && 'bg-[var(--accent-cyan)]',
            variant === 'teal' && 'bg-[var(--accent-teal)]',
            variant === 'purple' && 'bg-[var(--accent-purple)]',
            variant === 'default' && 'bg-[var(--ink-muted)]',
            pulse && 'animate-pulse'
          )}
        />
      )}
      {children}
    </span>
  );
};

// Status Badge - specialized for operational status
export interface StatusBadgeProps extends Omit<BadgeProps, 'variant'> {
  status: 'active' | 'inactive' | 'pending' | 'error' | 'synced' | 'syncing';
}

const statusConfig: Record<string, { variant: BadgeProps['variant']; label: string }> = {
  active: { variant: 'success', label: 'Active' },
  inactive: { variant: 'default', label: 'Inactive' },
  pending: { variant: 'warning', label: 'Pending' },
  error: { variant: 'danger', label: 'Error' },
  synced: { variant: 'success', label: 'Synced' },
  syncing: { variant: 'cyan', label: 'Syncing' },
};

const defaultStatusConfig = { variant: 'default' as const, label: 'Unknown' };

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  children,
  ...props
}) => {
  const config = statusConfig[status] ?? defaultStatusConfig;

  return (
    <Badge variant={config.variant} dot pulse={status === 'syncing'} {...props}>
      {children || config.label}
    </Badge>
  );
};

// Risk Badge - specialized for risk levels
export interface RiskBadgeProps extends Omit<BadgeProps, 'variant'> {
  tier: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  score?: number;
}

const tierConfig: Record<string, BadgeProps['variant']> = {
  LOW: 'success',
  MODERATE: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
};

export const RiskBadge: React.FC<RiskBadgeProps> = ({
  tier,
  score,
  ...props
}) => {
  return (
    <Badge variant={tierConfig[tier]} {...props}>
      {tier}
      {score !== undefined && <span className="opacity-75">({Math.round(score)})</span>}
    </Badge>
  );
};

export default Badge;
