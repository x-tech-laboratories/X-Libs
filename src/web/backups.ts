// The page's side of server/backup_routes: the calls BackupSettings makes, sent to the server.

import type { BackupClient } from "../backup_protocol.ts";
import type { Api } from "./api.ts";

// The base is where the server registered the routes, such as "/api/backups".
export function backup_client(api: Api, base = "/api/backups"): BackupClient {
  const named = (name: string) => `${base}/${encodeURIComponent(name)}`;
  return {
    list_backups: () => api(base),
    create_backup: () => api(base, "POST"),
    restore_backup: (name) => api(`${named(name)}/restore`, "POST"),
    remove_backup: (name) => api(named(name), "DELETE"),
    get_backup_schedule: () => api(`${base}/schedule`),
    set_backup_schedule: (schedule) => api(`${base}/schedule`, "PUT", schedule),
  };
}
