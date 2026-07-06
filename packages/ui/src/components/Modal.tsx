import React from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import type { Size } from '../tokens';
import { Button } from './Button';

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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Stack of currently-open dialogs so only the topmost one reacts to
// Escape/Tab when modals are nested.
const openDialogStack: Array<React.RefObject<HTMLDivElement>> = [];
// Body overflow value from before the first modal opened; restored only when
// the last open modal closes, so out-of-order closes can't unlock or
// permanently lock page scroll.
let bodyOverflowBeforeModals: string | null = null;

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
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  // Read the latest onClose through a ref so the focus-trap effect depends on
  // `open` alone — consumers pass inline closures, and re-running the effect
  // on every parent render would repeatedly steal focus from the user.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    if (openDialogStack.length === 0) {
      bodyOverflowBeforeModals = document.body.style.overflow;
    }
    document.body.style.overflow = 'hidden';
    openDialogStack.push(dialogRef);

    // Move focus into the dialog once it is mounted.
    const dialog = dialogRef.current;
    const firstFocusable = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? dialog)?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only the topmost open dialog reacts to keyboard control.
      if (openDialogStack[openDialogStack.length - 1] !== dialogRef) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const index = openDialogStack.indexOf(dialogRef);
      if (index !== -1) openDialogStack.splice(index, 1);
      if (openDialogStack.length === 0) {
        document.body.style.overflow = bodyOverflowBeforeModals ?? '';
        bodyOverflowBeforeModals = null;
        previouslyFocused.current?.focus?.();
      }
      // While other dialogs remain open, keep scroll locked and leave focus
      // to the still-open dialog's trap.
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={closeOnOverlayClick ? onClose : undefined}
      />

      {/* Modal Content */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
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
                <h2 id={titleId} className="text-xl font-semibold text-[var(--ink-primary)] font-[var(--font-display)]">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descriptionId} className="mt-1 text-sm text-[var(--ink-secondary)]">
                  {description}
                </p>
              )}
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="p-2 rounded-[var(--radius-md)] text-[var(--ink-muted)] hover:text-[var(--ink-primary)] hover:bg-[var(--bg-glass)] transition-all"
              >
                <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
    </div>,
    document.body
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
        <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
          {cancelText}
        </Button>
        <Button
          type="button"
          variant={variant === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={loading}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
};

export default Modal;
