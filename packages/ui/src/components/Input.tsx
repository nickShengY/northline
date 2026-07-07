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
    const autoId = React.useId();
    const inputId = id || `input-${autoId}`;
    const describedById = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

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
            <div aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]">
              {leftIcon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedById}
            className={clsx(
              'w-full min-h-[48px] px-4 py-3 rounded-[var(--radius-md)] font-[var(--font-body)] transition-all duration-[var(--transition-base)]',
              'bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--ink-primary)]',
              'placeholder:text-[var(--ink-muted)]',
              'focus:outline-none focus:border-[var(--accent-cyan)] focus:ring-2 focus:ring-[var(--accent-cyan)]/20',
              error && 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/20',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              variant === 'glass' && 'bg-[var(--bg-glass)] backdrop-blur-sm',
              className
            )}
            {...props}
          />

          {rightIcon && (
            <div aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]">
              {rightIcon}
            </div>
          )}
        </div>

        {error && (
          <p id={`${inputId}-error`} role="alert" className="mt-2 text-sm text-[var(--danger)] flex items-center gap-1">
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </p>
        )}

        {hint && !error && (
          <p id={`${inputId}-hint`} className="mt-2 text-sm text-[var(--ink-muted)]">
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
    const autoId = React.useId();
    const textareaId = id || `textarea-${autoId}`;
    const describedById = error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined;

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
          aria-invalid={error ? true : undefined}
          aria-describedby={describedById}
          className={clsx(
            'w-full px-4 py-3 rounded-[var(--radius-md)] font-[var(--font-body)] transition-all duration-[var(--transition-base)] resize-y min-h-[100px]',
            'bg-[var(--bg-secondary)] border border-[var(--border-default)] text-[var(--ink-primary)]',
            'placeholder:text-[var(--ink-muted)]',
            'focus:outline-none focus:border-[var(--accent-cyan)] focus:ring-2 focus:ring-[var(--accent-cyan)]/20',
            error && 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/20',
            variant === 'glass' && 'bg-[var(--bg-glass)] backdrop-blur-sm',
            className
          )}
          {...props}
        />

        {error && (
          <p id={`${textareaId}-error`} role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p>
        )}

        {hint && !error && (
          <p id={`${textareaId}-hint`} className="mt-2 text-sm text-[var(--ink-muted)]">{hint}</p>
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
    const autoId = React.useId();
    const selectId = id || `select-${autoId}`;
    const describedById = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined;

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
          aria-invalid={error ? true : undefined}
          aria-describedby={describedById}
          className={clsx(
            'w-full min-h-[48px] px-4 py-3 rounded-[var(--radius-md)] font-[var(--font-body)] transition-all duration-[var(--transition-base)] cursor-pointer',
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

        {error && <p id={`${selectId}-error`} role="alert" className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
        {hint && !error && <p id={`${selectId}-hint`} className="mt-2 text-sm text-[var(--ink-muted)]">{hint}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';

export default Input;
