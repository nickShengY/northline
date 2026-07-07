import React from 'react';
import { clsx } from 'clsx';

export interface ListItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  disabled?: boolean;
}

export interface ListProps {
  items: ListItem[];
  onSelect?: (id: string) => void;
  selectedId?: string;
  variant?: 'default' | 'cards' | 'compact';
  divided?: boolean;
  className?: string;
}

export const List: React.FC<ListProps> = ({
  items,
  onSelect,
  selectedId,
  variant = 'default',
  divided = true,
  className,
}) => {
  return (
    <ul
      className={clsx(
        'flex flex-col',
        divided && 'divide-y divide-[var(--border-default)]',
        className
      )}
    >
      {items.map((item) => (
        <li
          key={item.id}
          onClick={
            onSelect && !item.disabled
              ? (e) => {
                  // Ignore activations that came from a nested control
                  // (item.actions buttons, links, inputs).
                  const interactive = (e.target as HTMLElement).closest('button, a, input, select, textarea, label');
                  if (interactive && interactive !== e.currentTarget) return;
                  onSelect(item.id);
                }
              : undefined
          }
          onKeyDown={
            onSelect && !item.disabled
              ? (e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(item.id);
                  }
                }
              : undefined
          }
          tabIndex={onSelect && !item.disabled ? 0 : undefined}
          aria-disabled={onSelect && item.disabled ? true : undefined}
          className={clsx(
            'flex items-center gap-4 transition-all duration-[var(--transition-fast)]',
            variant === 'default' && 'px-4 py-3',
            variant === 'cards' && 'p-4 rounded-[var(--radius-lg)] bg-[var(--bg-glass)] mb-2 border border-[var(--border-default)]',
            variant === 'compact' && 'px-3 py-2',
            onSelect && !item.disabled && 'cursor-pointer hover:bg-[var(--bg-glass)]',
            selectedId === item.id && 'bg-[var(--accent-cyan)]/10',
            item.disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          {item.icon && (
            <div className="flex items-center justify-center w-10 h-10 rounded-[var(--radius-md)] bg-[var(--bg-secondary)]">
              {item.icon}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className="font-medium text-[var(--ink-primary)] truncate">
              {item.title}
            </p>
            {item.subtitle && (
              <p className="text-sm text-[var(--ink-secondary)] truncate">
                {item.subtitle}
              </p>
            )}
          </div>

          {item.badge && <div className="ml-2">{item.badge}</div>}
          {item.meta && <div className="text-sm text-[var(--ink-muted)]">{item.meta}</div>}
          {item.actions && <div className="flex items-center gap-2">{item.actions}</div>}
        </li>
      ))}
    </ul>
  );
};

// Activity List - specialized for activity feed
export interface ActivityItem extends ListItem {
  timestamp: Date;
  type?: 'info' | 'success' | 'warning' | 'danger';
}

export const ActivityList: React.FC<{ items: ActivityItem[]; className?: string }> = ({
  items,
  className,
}) => {
  const typeColors: Record<string, string> = {
    info: 'border-[var(--info)]',
    success: 'border-[var(--success)]',
    warning: 'border-[var(--warning)]',
    danger: 'border-[var(--danger)]',
  };

  return (
    <div role="log" aria-label="Activity feed" className={clsx('space-y-3', className)}>
      {items.map((item) => (
        <div
          key={item.id}
          className={clsx(
            'flex items-start gap-3 p-3 rounded-[var(--radius-lg)] bg-[var(--bg-glass)]',
            'border-l-2',
            item.type ? typeColors[item.type] : 'border-[var(--border-default)]'
          )}
        >
          {item.icon && (
            <div className="flex-shrink-0 mt-0.5">{item.icon}</div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[var(--ink-primary)]">{item.title}</p>
            {item.subtitle && (
              <p className="text-sm text-[var(--ink-secondary)] mt-1">{item.subtitle}</p>
            )}
          </div>
          <span className="text-xs text-[var(--ink-muted)] whitespace-nowrap">
            {formatRelativeTime(item.timestamp)}
          </span>
        </div>
      ))}
    </div>
  );
};

// Checklist
export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  required?: boolean;
}

export interface ChecklistProps {
  items: ChecklistItem[];
  onToggle: (id: string) => void;
  title?: string;
  className?: string;
}

export const Checklist: React.FC<ChecklistProps> = ({
  items,
  onToggle,
  title,
  className,
}) => {
  const checkedCount = items.filter((i) => i.checked).length;
  const requiredItems = items.filter((i) => i.required && !i.checked);

  return (
    <div className={clsx('space-y-3', className)}>
      {title && (
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-[var(--ink-primary)]">{title}</h4>
          <span className="text-sm text-[var(--ink-muted)]">
            {checkedCount}/{items.length}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => (
          <label
            key={item.id}
            className={clsx(
              'flex items-center gap-3 p-3 rounded-[var(--radius-md)] cursor-pointer transition-all',
              'border border-[var(--border-default)] hover:border-[var(--accent-cyan)]',
              item.checked && 'bg-[var(--success)]/5 border-[var(--success)]/30',
              item.required && !item.checked && 'border-[var(--warning)]/50'
            )}
          >
            <input
              type="checkbox"
              checked={item.checked}
              onChange={() => onToggle(item.id)}
              className="w-6 h-6 rounded accent-[var(--accent-cyan)]"
            />
            <span
              className={clsx(
                'flex-1',
                item.checked ? 'text-[var(--ink-muted)] line-through' : 'text-[var(--ink-primary)]'
              )}
            >
              {item.label}
            </span>
            {item.required && !item.checked && (
              <span className="text-xs text-[var(--warning)]">Required</span>
            )}
          </label>
        ))}
      </div>

      {requiredItems.length > 0 && (
        <p className="text-sm text-[var(--warning)]">
          {requiredItems.length} required item(s) remaining
        </p>
      )}
    </div>
  );
};

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default List;
