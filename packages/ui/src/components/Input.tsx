import React from 'react';
import { clsx } from 'clsx';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  variant?: 'default' | 'glass';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      variant = 'default',
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${Math.random().toString(36).slice(2, 9)}`;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-[var(--ink-secondary)] mb-2"
          >
            {label}
          </label>
        )}

        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]">
              {leftIcon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            className={clsx(
              'w-full px-4 py-3 rounded-[var(--radius-md)] font-[var(--font-body)] transition-all duration-[var(--transition-base)]',
              'bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--ink-primary)]',
              'placeholder:text-[var(--ink-muted)]',
              'focus:outline-none focus:border-[var(--accent-cyan)] focus:ring-2 focus:ring-[var(--accent-cyan)]/20 focus:shadow-[var(--shadow-glow-cyan)]',
              error && 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/20',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              variant === 'glass' && 'bg-[var(--bg-glass)] backdrop-blur-sm',
              className
            )}
            {...props}
          />

          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]">
              {rightIcon}
            </div>
          )}
        </div>

        {error && (
          <p className="mt-2 text-sm text-[var(--danger)] flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </p>
        )}

        {hint && !error && (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

// Textarea component
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  variant?: 'default' | 'glass';
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      error,
      hint,
      variant = 'default',
      id,
      ...props
    },
    ref
  ) => {
    const textareaId = id || `textarea-${Math.random().toString(36).slice(2, 9)}`;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-sm font-medium text-[var(--ink-secondary)] mb-2"
          >
            {label}
          </label>
        )}

        <textarea
          ref={ref}
          id={textareaId}
          className={clsx(
            'w-full px-4 py-3 rounded-[var(--radius-md)] font-[var(--font-body)] transition-all duration-[var(--transition-base)] resize-y min-h-[100px]',
            'bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--ink-primary)]',
            'placeholder:text-[var(--ink-muted)]',
            'focus:outline-none focus:border-[var(--accent-cyan)] focus:ring-2 focus:ring-[var(--accent-cyan)]/20 focus:shadow-[var(--shadow-glow-cyan)]',
            error && 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/20',
            variant === 'glass' && 'bg-[var(--bg-glass)] backdrop-blur-sm',
            className
          )}
          {...props}
        />

        {error && (
          <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>
        )}

        {hint && !error && (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">{hint}</p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

// Select component
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      label,
      error,
      hint,
      options,
      id,
      ...props
    },
    ref
  ) => {
    const selectId = id || `select-${Math.random().toString(36).slice(2, 9)}`;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-sm font-medium text-[var(--ink-secondary)] mb-2"
          >
            {label}
          </label>
        )}

        <select
          ref={ref}
          id={selectId}
          className={clsx(
            'w-full px-4 py-3 rounded-[var(--radius-md)] font-[var(--font-body)] transition-all duration-[var(--transition-base)] cursor-pointer',
            'bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--ink-primary)]',
            'focus:outline-none focus:border-[var(--accent-cyan)] focus:ring-2 focus:ring-[var(--accent-cyan)]/20',
            error && 'border-[var(--danger)]',
            className
          )}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {error && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
        {hint && !error && <p className="mt-2 text-sm text-[var(--ink-muted)]">{hint}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

export default Input;
