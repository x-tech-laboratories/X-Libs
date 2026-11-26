// Whether the page is phone-sized, the width at which Halon draws widgets in their phone layouts.

import { useEffect, useState } from "react";

const phone_query = "(max-width: 640px)";

const matches = (query: string): boolean => typeof window.matchMedia === "function" && window.matchMedia(query).matches;

// Whether a media query such as "(max-width: 700px)" matches, read again whenever it changes.
export function use_media_query(query: string): boolean {
  const [matched, set_matched] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const changed = () => set_matched(list.matches);
    changed();
    list.addEventListener("change", changed);
    return () => list.removeEventListener("change", changed);
  }, [query]);
  return matched;
}

// The page's phone size, read again whenever the window crosses it.
export function use_phone(): boolean {
  return use_media_query(phone_query);
}
