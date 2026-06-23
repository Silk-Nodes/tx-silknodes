"use client";

import { useEffect, useRef } from "react";

// Accessible modal focus management, shared by the share modal and the
// feed side panel. When `active` flips true it:
//   1. remembers what was focused (the trigger),
//   2. moves focus into the dialog (first focusable, or the container),
//   3. traps Tab / Shift+Tab inside the dialog,
//   4. restores focus to the trigger on close/unmount.
//
// Attach the returned ref to the dialog container. The container should
// have tabIndex={-1} so it can receive focus when it has no focusable
// children yet.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // Move focus in. Defer one frame so portaled content is in the DOM.
    const raf = requestAnimationFrame(() => {
      const focusables = getFocusable();
      (focusables[0] ?? node).focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = getFocusable();
      if (focusables.length === 0) {
        // Nothing focusable inside - keep focus on the container.
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      node.removeEventListener("keydown", onKeyDown);
      // Restore focus to the trigger if it's still in the document.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return ref;
}
