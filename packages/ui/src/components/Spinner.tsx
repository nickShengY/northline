import React from 'react';
import { clsx } from 'clsx';
import type { Size } from '../tokens';

export interface SpinnerProps {
  size?: Size;
  className?: string;
  variant?: 'cyan' | 'teal' | 'white';
}

const sizeClasses: Record<Size, string> = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
  xl: 'w-12 h-12',
};

const colorClasses: Record<string, string> = {
  cyan: 'text-[var(--accent-cyan)]',
  teal: 'text-[var(--accent-teal)]',
  white: 'text-white',
};

export const Spinner: React.FC<SpinnerProps> = ({
  size = 'md',
  className,
  variant = 'cyan',
}) => {
  return (
    <svg
      role="status"
      aria-label="Loading"
      className={clsx('animate-spin', sizeClasses[size], colorClasses[variant], className)}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
};

// Loading Overlay
export interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  visible,
  message = 'Loading...',
}) => {
  if (!visible) return null;

  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 p-8 rounded-[var(--radius-xl)] bg-[var(--bg-elevated)] border border-[var(--border-default)]">
        <Spinner size="xl" />
        <p className="text-[var(--ink-secondary)] animate-pulse">{message}</p>
      </div>
    </div>
  );
};

// Skeleton Loader
export interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'none';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  variant = 'text',
  width,
  height,
  animation = 'pulse',
}) => {
  const variantClasses: Record<string, string> = {
    text: 'rounded h-4',
    circular: 'rounded-full',
    rectangular: 'rounded-[var(--radius-md)]',
  };

  const animationClasses: Record<string, string> = {
    pulse: 'animate-pulse',
    wave: 'animate-shimmer bg-gradient-to-r from-[var(--bg-secondary)] via-[var(--bg-tertiary)] to-[var(--bg-secondary)] bg-[length:200%_100%]',
    none: '',
  };

  return (
    <div
      aria-hidden="true"
      className={clsx(
        'bg-[var(--bg-secondary)]',
        variantClasses[variant],
        animationClasses[animation],
        className
      )}
      style={{ width, height }}
    />
  );
};

export default Spinner;
