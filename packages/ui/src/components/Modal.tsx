import React from 'react';
import { clsx } from 'clsx';
import type { Size } from '../tokens';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: Size | 'full';
  children: React.ReactNode;
  footer?: React.ReactNode;
  closeOnOverlayClick?: boolean;
  showCloseButton?: boolean;
}

const sizeClasses: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-4xl',
};

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  closeOnOverlayClick = true,
  showCloseButton = true,
}) => {
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={closeOnOverlayClick ? onClose : undefined}
      />

      {/* Modal Content */}
      <div
        className={clsx(
          'relative w-full bg-[var(--bg-elevated)] rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)]',
          'border border-[var(--border-default)] animate-scale-in',
          sizeClasses[size]
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-start justify-between p-6 border-b border-[var(--border-default)]">
            <div>
              {title && (
                <h2 className="text-xl font-semibold text-[var(--ink-primary)] font-[var(--font-display)]">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-1 text-sm text-[var(--ink-secondary)]">
                  {description}
                </p>
              )}
            </div>
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-2 rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[var(--bg-glass)] transition-all"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="p-6">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-[var(--border-default)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

// Confirmation Modal - specialized for confirmations
export interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
  loading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  loading = false,
}) => {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-[var(--ink-secondary)]">{message}</p>
      <div className="flex items-center justify-end gap-3 mt-6">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-[var(--radius-md)] text-[var(--ink-secondary)] hover:bg-[var(--bg-glass)] transition-all"
        >
          {cancelText}
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={clsx(
            'px-4 py-2 rounded-[var(--radius-md)] font-medium transition-all',
            variant === 'danger'
              ? 'bg-[var(--danger)] text-white hover:opacity-90'
              : 'bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-teal)] text-[var(--ink-inverse)]'
          )}
        >
          {loading ? 'Loading...' : confirmText}
        </button>
      </div>
    </Modal>
  );
};

export default Modal;
