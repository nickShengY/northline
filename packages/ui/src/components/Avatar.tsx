import React from 'react';
import { clsx } from 'clsx';
import type { Size } from '../tokens';

export interface AvatarProps {
  src?: string;
  alt?: string;
  name?: string;
  size?: Size;
  status?: 'online' | 'offline' | 'busy' | 'away';
  className?: string;
}

const sizeClasses: Record<Size, string> = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
};

const statusColors: Record<string, string> = {
  online: 'bg-[var(--success)]',
  offline: 'bg-[var(--ink-muted)]',
  busy: 'bg-[var(--danger)]',
  away: 'bg-[var(--warning)]',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt,
  name,
  size = 'md',
  status,
  className,
}) => {
  const [imgError, setImgError] = React.useState(false);

  const showFallback = !src || imgError;

  return (
    <div className={clsx('relative inline-flex', className)}>
      <div
        className={clsx(
          'relative rounded-full overflow-hidden flex items-center justify-center',
          'ring-2 ring-[var(--border-default)]',
          sizeClasses[size]
        )}
      >
        {!showFallback && src ? (
          <img
            src={src}
            alt={alt || name}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : name ? (
          <div
            className="w-full h-full flex items-center justify-center font-medium text-white"
            style={{ backgroundColor: stringToColor(name) }}
          >
            {getInitials(name)}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[var(--bg-tertiary)] text-[var(--ink-muted)]">
            <svg className="w-1/2 h-1/2" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
          </div>
        )}
      </div>

      {status && (
        <span
          className={clsx(
            'absolute bottom-0 right-0 w-3 h-3 rounded-full ring-2 ring-[var(--bg-primary)]',
            statusColors[status]
          )}
        />
      )}
    </div>
  );
};

// Avatar Group
export interface AvatarGroupProps {
  children: React.ReactNode;
  max?: number;
  size?: Size;
}

export const AvatarGroup: React.FC<AvatarGroupProps> = ({
  children,
  max = 4,
  size = 'md',
}) => {
  const avatars = React.Children.toArray(children);
  const visible = avatars.slice(0, max);
  const remaining = avatars.length - max;

  return (
    <div className="flex -space-x-2">
      {visible.map((avatar, i) => (
        <div key={i} className="ring-2 ring-[var(--bg-primary)] rounded-full">
          {avatar}
        </div>
      ))}
      {remaining > 0 && (
        <div
          className={clsx(
            'rounded-full flex items-center justify-center bg-[var(--bg-tertiary)]',
            'ring-2 ring-[var(--bg-primary)]',
            sizeClasses[size]
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
};

export default Avatar;
