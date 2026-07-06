import React from 'react';
import { clsx } from 'clsx';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Anchor,
  Archive,
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  CheckCircle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Command,
  Copy,
  Download,
  Edit,
  Eye,
  EyeOff,
  Filter,
  Fish,
  Flame,
  GraduationCap,
  Home,
  Inbox,
  Info,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  MapPinPlus,
  Menu,
  Pin,
  PinOff,
  Plus,
  Radar,
  Radio,
  RefreshCw,
  Route,
  Save,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Ship,
  Siren,
  Snowflake,
  Sparkles,
  Sun,
  Timer,
  Trash2,
  Upload,
  UploadCloud,
  User,
  Users,
  X,
  XCircle,
  type LucideIcon
} from 'lucide-react';

const iconMap = {
  Activity,
  AlertCircle,
  AlertTriangle,
  Anchor,
  Archive,
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  CheckCircle,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Command,
  Copy,
  Download,
  Edit,
  Eye,
  EyeOff,
  Filter,
  Fish,
  Flame,
  GraduationCap,
  Home,
  Inbox,
  Info,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  MapPinPlus,
  Menu,
  Pin,
  PinOff,
  Plus,
  Radar,
  Radio,
  RefreshCw,
  Route,
  Save,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Ship,
  Siren,
  Snowflake,
  Sparkles,
  Sun,
  Timer,
  Trash2,
  Upload,
  UploadCloud,
  User,
  Users,
  X,
  XCircle
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof iconMap;

export type IconSize = 16 | 20 | 24 | 32 | 48;

export interface IconProps {
  name: IconName;
  size?: IconSize;
  color?: string;
  className?: string;
  spin?: boolean;
  /** Accessible name. Omit for decorative icons (hidden from screen readers). */
  label?: string;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 24,
  color,
  className,
  spin = false,
  label,
}) => {
  const LucideIcon = iconMap[name] as React.ComponentType<{
    size?: number;
    color?: string;
    className?: string;
    'aria-hidden'?: boolean;
    'aria-label'?: string;
    role?: string;
  }>;

  // Guard against unchecked casts from data-driven icon names: degrade to
  // nothing instead of crashing the tree with an invalid element type.
  if (!LucideIcon) {
    console.warn(`Icon "${name}" not found in lucide-react icon map`);
    return null;
  }

  return (
    <LucideIcon
      size={size}
      color={color}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      className={clsx(spin && 'animate-spin', className)}
    />
  );
};

// Pre-defined icon sets for common use cases
export const statusIcons = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

export const actionIcons = {
  add: Plus,
  edit: Edit,
  delete: Trash2,
  save: Save,
  cancel: X,
  confirm: Check,
  refresh: RefreshCw,
  sync: RefreshCw,
  download: Download,
  upload: Upload,
  share: Share2,
  copy: Copy,
} as const;

export const navIcons = {
  home: Home,
  dashboard: LayoutDashboard,
  settings: Settings,
  user: User,
  menu: Menu,
  search: Search,
  filter: Filter,
  bell: Bell,
} as const;

export const safetyIcons = {
  alert: AlertCircle,
  warning: AlertTriangle,
  shield: Shield,
  lifeBuoy: LifeBuoy,
  radio: Radio,
  anchor: Anchor,
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
      type="button"
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
