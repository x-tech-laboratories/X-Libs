// Times as the page shows them: how long ago, with the full date and time on hover.

import { age, stamp } from "../format.ts";

// A time as its age, such as "3h ago", or the missing text, a dash unless told otherwise, when there is none.
export function Age({ epoch, missing = "—" }: { epoch: number | null | undefined; missing?: string }) {
  if (!epoch) return <>{missing}</>;
  return <span title={stamp(epoch)}>{age(epoch)}</span>;
}
