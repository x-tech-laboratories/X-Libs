// Redraws a component whenever a watch it reads is bumped.

import { useSyncExternalStore } from "react";
import type { Watch } from "../watch.ts";

export type { Watch } from "../watch.ts";

export function use_watch(watch: Watch): number {
  return useSyncExternalStore(watch.subscribe, watch.version);
}
