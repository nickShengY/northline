import React from 'react';
import { clsx } from 'clsx';

export interface AppShellProps {
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
}

const maxWidthClasses: Record<string, string> = {
  sm: 'max-w-2xl',
  md: 'max-w-4xl',
  lg: 'max-w-6xl',
  xl: 'max-w-7xl',
  full: 'max-w-full',
};

export const AppShell: React.FC<AppShellProps> = ({
  children,
  maxWidth = 'lg',
  className,
}) => {
  return (
    <div
      className={clsx(
        'min-h-screen w-full mx-auto px-4 py-6 md:px-6 lg:px-8',
        maxWidthClasses[maxWidth],
        className
      )}
    >
      {children}
    </div>
  );
};

// Page Header
export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  breadcrumb?: Array<{ label: string; href?: string }>;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  eyebrow,
  actions,
  breadcrumb,
}) => {
  return (
    <header className="mb-8">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="flex items-center gap-2 text-sm text-[var(--ink-muted)] mb-2">
          {breadcrumb.map((item, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span>/</span>}
              {item.href ? (
                <a href={item.href} className="hover:text-[var(--accent-cyan)] transition-colors">
                  {item.label}
                </a>
              ) : (
                <span>{item.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      <div className="flex items-start justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="text-xs font-semibold tracking-widest uppercase text-[var(--accent-cyan)] mb-1">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl md:text-3xl font-bold text-[var(--ink-primary)] font-[var(--font-display)]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-[var(--ink-secondary)]">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
};

// Section
export interface SectionProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export const Section: React.FC<SectionProps> = ({
  title,
  description,
  children,
  className,
}) => {
  return (
    <section className={clsx('mb-8', className)}>
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h2 className="text-xl font-semibold text-[var(--ink-primary)] font-[var(--font-display)]">
              {title}
            </h2>
          )}
          {description && (
            <p className="mt-1 text-sm text-[var(--ink-secondary)]">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
};

// Grid Layout
export interface GridProps {
  children: React.ReactNode;
  cols?: 1 | 2 | 3 | 4;
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
}

const gapClasses: Record<string, string> = {
  sm: 'gap-3',
  md: 'gap-4',
  lg: 'gap-6',
};

export const Grid: React.FC<GridProps> = ({
  children,
  cols = 3,
  gap = 'md',
  className,
}) => {
  return (
    <div
      className={clsx(
        'grid',
        cols === 1 && 'grid-cols-1',
        cols === 2 && 'grid-cols-1 md:grid-cols-2',
        cols === 3 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
        cols === 4 && 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
        gapClasses[gap],
        className
      )}
    >
      {children}
    </div>
  );
};

// Stack Layout
export interface StackProps {
  children: React.ReactNode;
  gap?: 'none' | 'sm' | 'md' | 'lg';
  align?: 'start' | 'center' | 'end' | 'stretch';
  className?: string;
}

const stackGapClasses: Record<string, string> = {
  none: 'gap-0',
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
};

const stackAlignClasses: Record<string, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

export const Stack: React.FC<StackProps> = ({
  children,
  gap = 'md',
  align = 'stretch',
  className,
}) => {
  return (
    <div
      className={clsx(
        'flex flex-col',
        stackGapClasses[gap],
        stackAlignClasses[align],
        className
      )}
    >
      {children}
    </div>
  );
};

// Divider
export interface DividerProps {
  className?: string;
}

export const Divider: React.FC<DividerProps> = ({ className }) => {
  return (
    <hr className={clsx('border-t border-[var(--border-default)] my-4', className)} />
  );
};

export default AppShell;
