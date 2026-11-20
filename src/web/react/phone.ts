// Whether the page is phone-sized, the width at which Halon draws widgets in their phone layouts.

import { useEffect, useState } from "react";

const phone_query = "(max-width: 640px)";

const is_phone = (): boolean => typeof window.matchMedia === "function" && window.matchMedia(phone_query).matches;

// The page's phone size, read again whenever the window crosses it.
export function use_phone(): boolean {
  const [phone, set_phone] = useState(is_phone);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(phone_query);
    const changed = () => set_phone(list.matches);
    list.addEventListener("change", changed);
    return () => list.removeEventListener("change", changed);
  }, []);
  return phone;
}
