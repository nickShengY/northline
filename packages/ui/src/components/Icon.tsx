import React from 'react';
import { clsx } from 'clsx';
import * as LucideIcons from 'lucide-react';

export type IconName = keyof typeof LucideIcons;

export type IconSize = 16 | 20 | 24 | 32 | 48;

export interface IconProps {
  name: IconName;
  size?: IconSize;
  color?: string;
  className?: string;
  spin?: boolean;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 24,
  color,
  className,
  spin = false,
}) => {
  const LucideIcon = LucideIcons[name] as React.ComponentType<{
    size?: number;
    color?: string;
    className?: string;
  }>;

  if (!LucideIcon) {
    console.warn(`Icon "${name}" not found in lucide-react`);
    return null;
  }

  return (
    <LucideIcon
      size={size}
      color={color}
      className={clsx(spin && 'animate-spin', className)}
    />
  );
};

// Pre-defined icon sets for common use cases
export const statusIcons = {
  success: LucideIcons.CheckCircle,
  error: LucideIcons.XCircle,
  warning: LucideIcons.AlertTriangle,
  info: LucideIcons.Info,
} as const;

export const actionIcons = {
  add: LucideIcons.Plus,
  edit: LucideIcons.Edit,
  delete: LucideIcons.Trash2,
  save: LucideIcons.Save,
  cancel: LucideIcons.X,
  confirm: LucideIcons.Check,
  refresh: LucideIcons.RefreshCw,
  sync: LucideIcons.RefreshCw,
  download: LucideIcons.Download,
  upload: LucideIcons.Upload,
  share: LucideIcons.Share2,
  copy: LucideIcons.Copy,
} as const;

export const navIcons = {
  home: LucideIcons.Home,
  dashboard: LucideIcons.LayoutDashboard,
  settings: LucideIcons.Settings,
  user: LucideIcons.User,
  menu: LucideIcons.Menu,
  search: LucideIcons.Search,
  filter: LucideIcons.Filter,
  bell: LucideIcons.Bell,
} as const;

export const safetyIcons = {
  alert: LucideIcons.AlertCircle,
  warning: LucideIcons.AlertTriangle,
  shield: LucideIcons.Shield,
  lifeBuoy: LucideIcons.LifeBuoy,
  radio: LucideIcons.Radio,
  anchor: LucideIcons.Anchor,
} as const;

// Icon Button
export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'ghost' | 'outline';
  label: string; // for accessibility
}

const iconButtonSizes: Record<string, { button: string; icon: IconSize }> = {
  sm: { button: 'p-1.5', icon: 16 },
  md: { button: 'p-2', icon: 20 },
  lg: { button: 'p-3', icon: 24 },
};

const defaultIconButtonSize = { button: 'p-2', icon: 20 as const };

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  size = 'md',
  variant = 'ghost',
  label,
  className,
  ...props
}) => {
  const sizes = iconButtonSizes[size] ?? defaultIconButtonSize;

  return (
    <button
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex items-center justify-center rounded-[var(--radius-md)] transition-all',
        'duration-[var(--transition-fast)]',
        sizes.button,
        variant === 'ghost' && 'text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:bg-[var(--bg-glass)]',
        variant === 'outline' && 'border border-[var(--border-default)] text-[var(--ink-secondary)] hover:border-[var(--accent-cyan)] hover:text-[var(--accent-cyan)]',
        variant === 'default' && 'bg-[var(--bg-glass)] text-[var(--ink-primary)] hover:bg-[var(--bg-elevated)]',
        className
      )}
      {...props}
    >
      <Icon name={icon} size={sizes.icon} />
    </button>
  );
};

export default Icon;
