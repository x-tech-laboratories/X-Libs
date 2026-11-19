import type { SqlDatabase } from "./sql.ts";
import type { SyncEngine } from "./sync_engine.ts";
import { type SyncCredentials, type SyncDirection, type SyncPaths, type SyncStatus } from "./sync_protocol.ts";
export interface SyncConfig {
    server_url: string;
    token: string;
    user?: string;
}
export interface SyncStorage {
    read_config: () => SyncConfig | null;
    write_config: (config: SyncConfig) => void;
    remove_config: () => void;
    back_up_before_download: () => void | Promise<void>;
}
export interface SyncClientOptions {
    engine: SyncEngine;
    database: () => SqlDatabase;
    storage: SyncStorage;
    on_remote_change?: () => void;
    on_status?: (status: SyncStatus) => void;
    paths?: Partial<SyncPaths>;
    hello_event?: string;
    changed_event?: string;
    client_id_header?: string;
    data_name?: string;
    device_name?: string;
    local_check_ms?: number;
    full_sync_ms?: number;
    retry_after_failure_ms?: number;
    event_stream_retry_ms?: number;
    fetch?: typeof fetch;
}
export type SyncClient = ReturnType<typeof create_sync_client>;
export declare function asks_for_code(error: unknown): boolean;
export declare function normalise_server_url(server_url: string): string;
export declare function create_sync_client(options: SyncClientOptions): {
    start: () => void;
    stop: () => void;
    sync_now: () => Promise<SyncStatus>;
    connect: (server_url: string, credentials: SyncCredentials | string | null, direction: SyncDirection) => Promise<SyncStatus>;
    disconnect: () => SyncStatus;
    get_status: () => SyncStatus;
};
