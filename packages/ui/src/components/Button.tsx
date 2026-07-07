import React from 'react';
import { clsx } from 'clsx';
import type { Size } from '../tokens';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  glow?: boolean;
}

const sizeClasses: Record<Size, string> = {
  sm: 'min-h-[44px] px-3 py-2 text-sm',
  md: 'min-h-[44px] px-4 py-2.5 text-base',
  lg: 'min-h-[48px] px-6 py-3 text-lg',
  xl: 'min-h-[56px] px-8 py-4 text-xl',
};

const variantClasses: Record<string, string> = {
  primary: 'bg-gradient-to-r from-[var(--accent-cyan)] via-[var(--accent-teal)] to-[var(--accent-purple)] text-[var(--ink-inverse)] font-semibold shadow-lg hover:shadow-[var(--shadow-glow-cyan)] hover:-translate-y-0.5',
  secondary: 'bg-transparent border border-[var(--border-default)] text-[var(--ink-primary)] hover:bg-[var(--bg-glass)] hover:border-[var(--accent-cyan)] hover:shadow-[var(--shadow-glow-cyan)]',
  ghost: 'bg-transparent text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--bg-glass)]',
  danger: 'bg-gradient-to-r from-[var(--danger)] to-[var(--accent-pink)] text-white font-semibold shadow-lg hover:shadow-[0_0_20px_rgba(239,68,68,0.4)] hover:-translate-y-0.5',
  success: 'bg-gradient-to-r from-[var(--success)] to-[var(--accent-teal)] text-white font-semibold shadow-lg hover:shadow-[var(--shadow-glow-teal)] hover:-translate-y-0.5',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      glow = false,
      disabled,
      type = 'button',
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={clsx(
          'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium transition-all duration-[var(--transition-base)] relative overflow-hidden hover-shine',
          sizeClasses[size],
          variantClasses[variant],
          fullWidth && 'w-full',
          glow && 'animate-glow-pulse',
          (disabled || loading) && 'opacity-70 cursor-not-allowed pointer-events-none',
          className
        )}
        {...props}
      >
        {loading ? (
          <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : leftIcon}
        {children}
        {!loading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';

export default Button;
