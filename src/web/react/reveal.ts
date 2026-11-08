// A long list shown a page at a time, the next page added as its end scrolls into view.

import { useCallback, useEffect, useRef, useState } from "react";

export interface RevealOptions {
  // How far before the end comes into view the next page is added, as a CSS margin.
  root_margin?: string;
  // How many to show at first, such as the count shown before the page was left.
  initial_count?: number;
}

export interface Reveal {
  // How many items to show now.
  shown_count: number;
  // The ref for an element placed after the last shown item.
  more_ref: (element: Element | null) => void;
  // Goes back to the first page, such as when the list is replaced.
  reset: () => void;
}

export function use_reveal(page_size: number, options: RevealOptions = {}): Reveal {
  const root_margin = options.root_margin ?? "200px";
  const [shown_count, set_shown_count] = useState(() => Math.max(page_size, options.initial_count ?? page_size));
  const observer = useRef<IntersectionObserver | null>(null);
  const marker = useRef<Element | null>(null);

  const more_ref = useCallback((element: Element | null) => {
    observer.current?.disconnect();
    observer.current = null;
    marker.current = element;
    if (!element) return;

    observer.current = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) set_shown_count((count) => count + page_size);
    }, { rootMargin: root_margin });
    observer.current.observe(element);
  }, [page_size, root_margin]);

  // Watching the marker afresh after each page asks again whether it is still in view, so a short page keeps filling.
  useEffect(() => {
    if (!observer.current || !marker.current) return;
    observer.current.unobserve(marker.current);
    observer.current.observe(marker.current);
  }, [shown_count]);

  useEffect(() => () => observer.current?.disconnect(), []);

  const reset = useCallback(() => set_shown_count(page_size), [page_size]);

  return { shown_count, more_ref, reset };
}
