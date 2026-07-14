import { useEffect, useRef, type ReactNode } from "react";

type ModalShellProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  tone?: "sheet" | "dialog" | "confirm" | "dark";
  className?: string;
  contentClassName?: string;
  titleClassName?: string;
  actionsClassName?: string;
  initialFocusSelector?: string;
};

export function ModalShell({
  title,
  onClose,
  children,
  tone = "sheet",
  className,
  contentClassName,
  titleClassName,
  actionsClassName,
  initialFocusSelector,
}: ModalShellProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    lastActiveElementRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTarget = () => {
      const element =
        shellRef.current?.querySelector<HTMLElement>(initialFocusSelector ?? '[data-modal-initial-focus="true"]') ??
        shellRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea");
      element?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    const timer = window.setTimeout(focusTarget, 0);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      lastActiveElementRef.current?.focus?.();
    };
  }, [initialFocusSelector, onClose]);

  const toneClass =
    tone === "dark"
      ? "bg-slate-950/50"
      : tone === "confirm"
        ? "bg-slate-950/35"
        : "bg-slate-950/30";

  const panelClass =
    tone === "dark"
      ? "max-w-md border border-white/15 bg-slate-950 text-white"
      : "modal-neu-panel max-w-md";

  const headerTitleClass =
    tone === "dark"
      ? "text-lg sm:text-xl font-semibold text-white"
      : titleClassName ?? "text-base sm:text-lg font-semibold text-ink";

  return (
    <div
      className={`modal-neu-overlay fixed inset-0 z-50 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:pb-6 sm:pt-16 ${toneClass} ${className ?? ""}`}
    >
      <div className="mx-auto flex h-full w-full max-w-5xl items-end justify-center sm:items-center">
        <div
          ref={shellRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-shell-title"
          className={`flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-[2rem] shadow-soft sm:max-h-[calc(100vh-4rem)] ${panelClass} ${contentClassName ?? ""}`}
        >
          <div className="modal-neu-header flex items-center justify-between gap-3 px-5 py-4">
            <h2 id="modal-shell-title" className={headerTitleClass}>
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="modal-neu-close rounded-full px-3 py-2 text-sm font-semibold text-muted"
            >
              닫기
            </button>
          </div>
          <div className={`modal-neu-body min-h-0 flex-1 overflow-y-auto px-5 py-4 ${actionsClassName ?? ""}`}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
