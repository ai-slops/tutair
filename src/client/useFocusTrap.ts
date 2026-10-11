import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options: { readonly closeBlocked?: boolean; readonly mediaQuery?: string } = {},
): void {
  const closeRef = useRef(onClose);
  const blockedRef = useRef(options.closeBlocked ?? false);
  useLayoutEffect(() => {
    closeRef.current = onClose;
    blockedRef.current = options.closeBlocked ?? false;
  }, [onClose, options.closeBlocked]);

  useEffect(() => {
    if (!active) return;
    if (options.mediaQuery !== undefined && !window.matchMedia(options.mediaQuery).matches) return;

    const container = containerRef.current;
    if (container === null) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!container.contains(document.activeElement))
      container.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !blockedRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [active, containerRef, options.mediaQuery]);
}
