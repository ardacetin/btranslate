import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Notification, NotificationViewport, type NotificationStatus } from '@/components/base/notification/notification';
import { Button } from '@/components/base/buttons/button';
import { cx } from '@/utils/cx';

/* ── Card (BoardUI panel: rounded-3xl + border-button-default) ─────────── */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cx('rounded-3xl border border-border-button-default bg-background-primary-default p-5 shadow-xs sm:p-6', className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-headline-semibold text-text-primary">{title}</h2>
        {description && <p className="mt-1 text-body-regular text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-body-regular text-text-tertiary">{children}</p>;
}

/* ── Dialog (react-aria Modal: focus trap, Escape, scroll lock built in) ── */
export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  submitLabel?: string;
  danger?: boolean;
  /** Throw to show the message inside the dialog; resolve to close it. */
  onSubmit: () => Promise<void> | void;
}

export function Dialog({ isOpen, onClose, title, description, children, submitLabel = 'Kaydet', danger, onSubmit }: DialogProps) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem başarısız');
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open) { setError(''); onClose(); } }}
      isDismissable
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4"
    >
      <Modal className="w-full max-w-md rounded-3xl border border-border-button-default bg-background-primary-default p-6 shadow-xl outline-none">
        <AriaDialog className="outline-none">
          <form onSubmit={submit} noValidate>
            <Heading slot="title" className="text-title-3-semibold text-text-primary">{title}</Heading>
            {description && <p className="mt-1.5 text-body-regular text-text-secondary">{description}</p>}
            {children && <div className="mt-5 flex flex-col gap-4">{children}</div>}
            <p role="alert" className="mt-3 min-h-5 text-body-2-medium text-text-error-primary">{error}</p>
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Vazgeç</Button>
              <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>{submitLabel}</Button>
            </div>
          </form>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

/* ── Toasts (BoardUI Notification stack) ────────────────────────────────── */
type ToastFn = (title: string, status?: NotificationStatus | 'neutral') => void;
const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; title: string; status: NotificationStatus }[]>([]);
  const nextId = useRef(1);
  const push = useCallback<ToastFn>((title, status = 'neutral') => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-3), { id, title, status: status as NotificationStatus }]);
  }, []);
  const remove = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <NotificationViewport position="bottom-end" aria-label="Bildirimler">
        {items.map((t) => (
          <Notification
            key={t.id}
            title={t.title}
            status={t.status}
            dismissible
            closeLabel="Kapat"
            autoDismissDuration={t.status === 'error' ? 6000 : 3500}
            onDismiss={() => remove(t.id)}
          />
        ))}
      </NotificationViewport>
    </ToastContext.Provider>
  );
}

/* ── Small helpers ──────────────────────────────────────────────────────── */
export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-body-medium text-text-primary">{label}</label>
      {children}
      {hint && <span className="text-caption-1-regular text-text-tertiary">{hint}</span>}
    </div>
  );
}

/** Native <select> styled like BoardUI's select trigger (used where a plain
 *  form control is simpler, e.g. device lists that change at runtime). */
export const nativeSelectClass = cx(
  'h-9 w-full cursor-pointer rounded-2lg border border-border-button-default bg-background-primary-default px-2.5 shadow-xs',
  'text-body-medium text-text-primary outline-none hover:border-border-button-hover',
  'focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2',
);

export const nativeInputClass = cx(
  'h-9 w-full rounded-2lg border border-border-button-default bg-background-primary-default px-3 shadow-xs',
  'text-body-regular text-text-primary placeholder:text-text-placeholder outline-none',
  'hover:border-border-button-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2',
);
