import React from 'react';
import { clsx } from 'clsx';

export interface NavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
  disabled?: boolean;
}

export interface NavigationProps {
  items: NavItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  variant?: 'tabs' | 'pills' | 'sidebar';
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export const Navigation: React.FC<NavigationProps> = ({
  items,
  activeId,
  onSelect,
  variant = 'tabs',
  orientation = 'horizontal',
  className,
}) => {
  return (
    <nav
      className={clsx(
        'flex',
        orientation === 'horizontal' ? 'flex-row flex-wrap gap-2' : 'flex-col gap-1',
        className
      )}
    >
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => !item.disabled && onSelect(item.id)}
          disabled={item.disabled}
          className={clsx(
            'flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-md)] font-medium transition-all',
            'duration-[var(--transition-base)] cursor-pointer',
            variant === 'tabs' && [
              'border-b-2 border-transparent rounded-b-none',
              activeId === item.id
                ? 'border-[var(--accent-cyan)] text-[var(--ink-primary)] bg-[var(--bg-glass)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--bg-glass)]',
            ],
            variant === 'pills' && [
              activeId === item.id
                ? 'bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-teal)] text-[var(--ink-inverse)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--bg-glass)]',
            ],
            variant === 'sidebar' && [
              'justify-start w-full',
              activeId === item.id
                ? 'bg-[var(--bg-glass)] border-l-2 border-[var(--accent-cyan)] text-[var(--ink-primary)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--bg-glass)]/50',
            ],
            item.disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          {item.icon}
          <span>{item.label}</span>
          {item.badge !== undefined && (
            <span className="ml-auto px-2 py-0.5 text-xs rounded-full bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]">
              {item.badge}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
};

// Bottom Navigation - for mobile apps
export interface BottomNavItem extends NavItem {
  href?: string;
}

export interface BottomNavigationProps {
  items: BottomNavItem[];
  activeId?: string;
  onSelect: (id: string) => void;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({
  items,
  activeId,
  onSelect,
}) => {
  return (
    <nav className="bottom-navigation sticky bottom-0 z-[var(--z-sticky)] mt-6 bg-[var(--bg-elevated)]/95 backdrop-blur-lg border border-[var(--border-default)] rounded-[var(--radius-lg)]">
      <div className="flex items-center justify-around max-w-lg mx-auto px-2 py-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => !item.disabled && onSelect(item.id)}
            disabled={item.disabled}
            className={clsx(
              'flex flex-col items-center gap-1 px-3 py-2 rounded-[var(--radius-md)] transition-all',
              'duration-[var(--transition-fast)] min-w-[64px]',
              activeId === item.id
                ? 'text-[var(--accent-cyan)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]',
              item.disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            <span className="text-xl">{item.icon}</span>
            <span className="text-xs font-medium">{item.label}</span>
            {item.badge !== undefined && (
              <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center text-[10px] rounded-full bg-[var(--danger)] text-white">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
};

// Sidebar Navigation
export interface SidebarNavigationProps {
  items: NavItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  collapsed?: boolean;
}

export const SidebarNavigation: React.FC<SidebarNavigationProps> = ({
  items,
  activeId,
  onSelect,
  header,
  footer,
  collapsed = false,
}) => {
  return (
    <aside
      className={clsx(
        'flex flex-col h-screen bg-[var(--bg-elevated)] border-r border-[var(--border-default)]',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {header && (
        <div className="p-4 border-b border-[var(--border-default)]">
          {header}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto p-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => !item.disabled && onSelect(item.id)}
            disabled={item.disabled}
            title={collapsed ? item.label : undefined}
            className={clsx(
              'flex items-center gap-3 w-full px-3 py-2.5 rounded-[var(--radius-md)] transition-all',
              'duration-[var(--transition-fast)] mb-1',
              activeId === item.id
                ? 'bg-[var(--bg-glass)] text-[var(--accent-cyan)]'
                : 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--bg-glass)]/50',
              item.disabled && 'opacity-50 cursor-not-allowed',
              collapsed && 'justify-center'
            )}
          >
            <span className="text-lg">{item.icon}</span>
            {!collapsed && (
              <>
                <span className="flex-1 text-left">{item.label}</span>
                {item.badge !== undefined && (
                  <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]">
                    {item.badge}
                  </span>
                )}
              </>
            )}
          </button>
        ))}
      </nav>

      {footer && (
        <div className="p-4 border-t border-[var(--border-default)]">
          {footer}
        </div>
      )}
    </aside>
  );
};

// Breadcrumbs
export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  items,
  className,
}) => {
  return (
    <nav className={clsx('flex items-center gap-2 text-sm', className)}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <svg className="w-4 h-4 text-[var(--ink-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
          {item.href ? (
            <a
              href={item.href}
              className="text-[var(--ink-secondary)] hover:text-[var(--accent-cyan)] transition-colors"
            >
              {item.label}
            </a>
          ) : (
            <span className="text-[var(--ink-primary)]">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};

export default Navigation;
