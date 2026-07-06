import React from 'react';
import { clsx } from 'clsx';
import type { Radius } from '../tokens';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'glass' | 'solid' | 'outline';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  radius?: Radius;
  hover?: boolean;
  glow?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

const paddingClasses: Record<string, string> = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-7',
};

const variantClasses: Record<string, string> = {
  glass: 'bg-[var(--bg-glass)] backdrop-blur-xl border border-[var(--border-glass)]',
  solid: 'bg-[var(--bg-elevated)] border border-[var(--border-default)]',
  outline: 'bg-transparent border border-[var(--border-default)]',
};

const radiusClasses: Record<Radius, string> = {
  none: 'rounded-none',
  sm: 'rounded-[var(--radius-sm)]',
  md: 'rounded-[var(--radius-md)]',
  lg: 'rounded-[var(--radius-lg)]',
  xl: 'rounded-[var(--radius-xl)]',
  full: 'rounded-full',
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      variant = 'glass',
      padding = 'md',
      radius = 'lg',
      hover = true,
      glow = false,
      header,
      footer,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={clsx(
          'nl-card relative overflow-hidden transition-all duration-[var(--transition-base)]',
          variantClasses[variant],
          paddingClasses[padding],
          radiusClasses[radius],
          hover && 'hover:bg-[var(--bg-glass-hover)] hover:border-[var(--border-hover)] hover:-translate-y-1 hover:shadow-[var(--shadow-glow-cyan)]',
          glow && 'shadow-[var(--shadow-glow-cyan)]',
          className
        )}
        {...props}
      >
        {/* Top gradient accent, revealed on hover (see .nl-card rules in styles.css) */}
        <div aria-hidden="true" className="nl-card-accent absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[var(--accent-cyan)] via-[var(--accent-teal)] to-[var(--accent-purple)] opacity-0 transition-opacity" />

        {header && (
          <div className="mb-4 pb-4 border-b border-[var(--border-default)]">
            {header}
          </div>
        )}

        {children}

        {footer && (
          <div className="mt-4 pt-4 border-t border-[var(--border-default)]">
            {footer}
          </div>
        )}
      </div>
    );
  }
);

Card.displayName = 'Card';

// Card Header subcomponent — stacks title/description vertically; pass
// `actions` for a right-aligned control slot.
export const CardHeader: React.FC<{
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ children, actions, className }) => (
  <div className={clsx('flex items-start justify-between gap-3 mb-4', className)}>
    <div className="flex flex-col gap-1 min-w-0">{children}</div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

// Card Title subcomponent
export const CardTitle: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <h3 className={clsx('text-lg font-semibold text-[var(--ink-primary)] font-[var(--font-display)]', className)}>
    {children}
  </h3>
);

// Card Description subcomponent
export const CardDescription: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <p className={clsx('text-sm text-[var(--ink-secondary)]', className)}>
    {children}
  </p>
);

// Card Content subcomponent
export const CardContent: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div className={clsx('', className)}>
    {children}
  </div>
);

// Card Footer subcomponent
export const CardFooter: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div className={clsx('flex items-center gap-2 mt-4 pt-4 border-t border-[var(--border-default)]', className)}>
    {children}
  </div>
);

export default Card;
