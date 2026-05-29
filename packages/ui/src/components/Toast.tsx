import React from 'react';
import { clsx } from 'clsx';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

export interface ToastProps extends Toast {
  onClose: (id: string) => void;
}

const typeConfig: Record<ToastType, { icon: React.ReactNode; className: string }> = {
  success: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    className: 'border-[var(--success)]/40 bg-[var(--success)]/10',
  },
  error: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
    className: 'border-[var(--danger)]/40 bg-[var(--danger)]/10',
  },
  warning: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    className: 'border-[var(--warning)]/40 bg-[var(--warning)]/10',
  },
  info: {
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    className: 'border-[var(--info)]/40 bg-[var(--info)]/10',
  },
};

const colorConfig: Record<ToastType, string> = {
  success: 'text-[var(--success)]',
  error: 'text-[var(--danger)]',
  warning: 'text-[var(--warning)]',
  info: 'text-[var(--info)]',
};

export const ToastItem: React.FC<ToastProps> = ({
  id,
  type,
  title,
  message,
  onClose,
}) => {
  const config = typeConfig[type];

  React.useEffect(() => {
    const timer = setTimeout(() => onClose(id), 5000);
    return () => clearTimeout(timer);
  }, [id, onClose]);

  return (
    <div
      className={clsx(
        'flex items-start gap-3 p-4 rounded-[var(--radius-lg)] border backdrop-blur-sm',
        'animate-slide-in-right shadow-lg',
        config.className
      )}
    >
      <span className={colorConfig[type]}>{config.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[var(--ink-primary)]">{title}</p>
        {message && (
          <p className="mt-1 text-sm text-[var(--ink-secondary)]">{message}</p>
        )}
      </div>
      <button
        onClick={() => onClose(id)}
        className="p-1 rounded hover:bg-white/10 text-[var(--ink-muted)] transition-all"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

// Toast Container
export interface ToastContainerProps {
  toasts: Toast[];
  onClose: (id: string) => void;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

const positionClasses: Record<string, string> = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
};

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onClose,
  position = 'top-right',
}) => {
  return (
    <div
      className={clsx(
        'fixed z-[var(--z-toast)] flex flex-col gap-2 w-80',
        positionClasses[position]
      )}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} {...toast} onClose={onClose} />
      ))}
    </div>
  );
};

// Toast Hook
export const useToast = () => {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const addToast = React.useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = React.useCallback(
    (title: string, message?: string) => addToast({ type: 'success', title, message }),
    [addToast]
  );

  const error = React.useCallback(
    (title: string, message?: string) => addToast({ type: 'error', title, message }),
    [addToast]
  );

  const warning = React.useCallback(
    (title: string, message?: string) => addToast({ type: 'warning', title, message }),
    [addToast]
  );

  const info = React.useCallback(
    (title: string, message?: string) => addToast({ type: 'info', title, message }),
    [addToast]
  );

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    warning,
    info,
    ToastContainer: () => <ToastContainer toasts={toasts} onClose={removeToast} />,
  };
};

export default Toast;
