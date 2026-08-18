"use client";

import { useEffect } from 'react';

export function useDismissibleDetails(selector: string) {
  useEffect(() => {
    const openSelector = selector.split(',').map((part) => `${part.trim()}[open]`).join(', ');
    const openDetails = () => Array.from(document.querySelectorAll<HTMLDetailsElement>(openSelector));

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      for (const details of openDetails()) {
        if (target && !details.contains(target)) {
          details.open = false;
        }
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      const active = document.activeElement;
      const details = active instanceof Element
        ? active.closest<HTMLDetailsElement>(openSelector)
        : openDetails().at(-1) ?? null;
      if (!details) {
        return;
      }
      event.preventDefault();
      details.open = false;
      details.querySelector<HTMLElement>('summary')?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selector]);
}
