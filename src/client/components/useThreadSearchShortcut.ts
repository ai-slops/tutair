import { useEffect } from "react";

export function useThreadSearchShortcut(openThreads: () => void): void {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key !== "/" ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      )
        return;
      event.preventDefault();
      openThreads();
      requestAnimationFrame(() =>
        document.querySelector<HTMLInputElement>(".search input")?.focus(),
      );
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [openThreads]);
}
