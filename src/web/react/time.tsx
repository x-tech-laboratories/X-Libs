// Times as the page shows them: how long ago, with the full date and time on hover, and the current time kept fresh.

import { useEffect, useState } from "react";
import { age, stamp } from "../format.ts";

// A time as its age, such as "3h ago", or the missing text, a dash unless told otherwise, when there is none.
export function Age({ epoch, missing = "—" }: { epoch: number | null | undefined; missing?: string }) {
  if (!epoch) return <>{missing}</>;
  return <span title={stamp(epoch)}>{age(epoch)}</span>;
}

// The current time, read again every interval, a minute unless told otherwise, so a page notices the day turning.
export function use_now(interval_in_milliseconds = 60_000): Date {
  const [now, set_now] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => set_now(new Date()), interval_in_milliseconds);
    return () => clearInterval(timer);
  }, [interval_in_milliseconds]);
  return now;
}
