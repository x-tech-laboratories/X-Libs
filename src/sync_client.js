// A device's side of sync: it keeps its own SQLite copy, sends its changes within seconds, takes everyone else's in the same
// round trip, follows the server's event stream to hear of changes at once, and works on offline until the server answers.
// It runs wherever fetch does: a desktop app's main process, a server, or a phone's page.
import { default_sync_paths, } from "./sync_protocol.js";
class SyncHttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
// What the server says when the password was right and only the authenticator code is missing.
const code_needed_text = "Enter the code from your authenticator app.";
// Whether a refused connect asks for the authenticator code, even after crossing to the page as plain text.
export function asks_for_code(error) {
    return String(error instanceof Error ? error.message : error).includes(code_needed_text);
}
// A trailing slash keeps the server's own folder when paths are resolved against it.
export function normalise_server_url(server_url) {
    const url = new URL(server_url.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error("the server address must start with http:// or https://");
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
}
// fetch reports every network problem as "fetch failed", so the reason underneath is shown with it.
function describe_failure(error) {
    if (!(error instanceof Error))
        return String(error);
    const cause = error.cause instanceof Error ? error.cause.message : "";
    return cause ? `${error.message}: ${cause}` : error.message;
}
// ── Client ───────────────────────────────────────────────────────────────────
export function create_sync_client(options) {
    const { engine, storage } = options;
    const paths = { ...default_sync_paths, ...options.paths };
    const hello_event = options.hello_event ?? "hello";
    const changed_event = options.changed_event ?? "changed";
    const client_id_header = options.client_id_header ?? "x-client-id";
    const data_name = options.data_name ?? "data";
    const local_check_ms = options.local_check_ms ?? 2000;
    const full_sync_ms = options.full_sync_ms ?? 60_000;
    const retry_after_failure_ms = options.retry_after_failure_ms ?? 30_000;
    const event_stream_retry_ms = options.event_stream_retry_ms ?? 15_000;
    const do_fetch = (input, init) => (options.fetch ?? fetch)(input, init);
    const off = { state: "off", server_url: "", user: "", last_synced_at: "", error: "" };
    let status = { ...off };
    // The client id from the server's event stream, so the server does not tell this device about its own changes.
    let event_client_id = "";
    let exchanging = null;
    let timers = [];
    let event_stream = null;
    let last_failure_at = 0;
    // ── Requests ─────────────────────────────────────────────────────────────
    async function request_server(config, path, body) {
        const response = await do_fetch(new URL(path, config.server_url), {
            method: body === undefined ? "GET" : "POST",
            headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", [client_id_header]: event_client_id },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (response.status === 401)
            throw new SyncHttpError(401, "the server no longer accepts this device; sign in again");
        if (!response.ok)
            throw new SyncHttpError(response.status, `the server answered ${response.status}: ${await response.text()}`);
        return (await response.json());
    }
    // ── Status ───────────────────────────────────────────────────────────────
    // The pending count is read fresh each time, since every local edit changes it.
    function get_status() {
        return { ...status, pending_changes: status.state === "off" ? 0 : engine.count_unpushed_rows(options.database()) };
    }
    function set_status(changes) {
        status = { ...status, ...changes };
        options.on_status?.(get_status());
    }
    // Syncing waits until the user chooses again whether the server's copy or this device's wins.
    function ask_which_copy_to_keep(reason) {
        stop_background_sync();
        set_status({ state: "needs_setup", error: `${reason}; choose which copy of the ${data_name} to keep` });
    }
    // A refused token or a replaced server needs the user; anything else is the network, which is tried again later.
    function record_failure(error) {
        const message = describe_failure(error);
        if (error instanceof SyncHttpError && error.status === 409) {
            engine.write_state(options.database(), { server_generation: "" });
            ask_which_copy_to_keep(`the server's ${data_name} were replaced`);
        }
        else if (error instanceof SyncHttpError)
            set_status({ state: "failed", error: message });
        else
            set_status({ state: "offline", error: message });
    }
    // ── Exchanging ───────────────────────────────────────────────────────────
    async function exchange() {
        const config = storage.read_config();
        if (!config)
            return;
        const database = options.database();
        const state = engine.read_state(database);
        if (state.server_generation === "")
            return ask_which_copy_to_keep("this device restored a backup");
        set_status({ state: "syncing" });
        const outgoing = engine.collect_unpushed_changes(database);
        const request = { site: state.site, generation: state.server_generation, cursor: state.pulled_seq, changes: outgoing.changes };
        const response = await request_server(config, paths.exchange, request);
        const applied = engine.apply_changes(database, response.changes);
        engine.write_state(database, { pushed_seq: outgoing.up_to_seq, pulled_seq: response.cursor });
        set_status({ state: "idle", last_synced_at: new Date().toISOString(), error: "" });
        if (applied > 0)
            options.on_remote_change?.();
    }
    // Sends this device's new changes and takes everyone else's in one round trip; calls made while one runs wait for it.
    function sync_now() {
        exchanging ??= exchange()
            .catch(record_failure)
            .finally(() => {
            exchanging = null;
        });
        return exchanging.then(get_status);
    }
    // ── Connecting ───────────────────────────────────────────────────────────
    // Signs this device in to the server for a token of its own, which it sends from then on.
    async function sign_in(server_url, credentials) {
        const response = await do_fetch(new URL(paths.login, server_url), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...credentials, device: options.device_name ?? "a device" }),
        });
        const answer = await response.json().catch(() => ({}));
        if (!response.ok || !answer.token)
            throw new Error(answer.error ?? `the server answered ${response.status}`);
        return { server_url, token: answer.token, user: credentials.name.trim().toLowerCase() };
    }
    // Gives the token back so the server forgets this device; a server out of reach keeps it until the user revokes it there.
    function sign_out(config) {
        void do_fetch(new URL(paths.logout, config.server_url), { method: "POST", headers: { authorization: `Bearer ${config.token}` } }).catch(() => { });
    }
    // Signs in with a name and password, or reuses the saved token when none are given, as when choosing a direction again;
    // a token given by hand also works. Either way the device takes a fresh id, so a database copied from another device never passes for it.
    async function connect(server_url, credentials, direction) {
        const saved = storage.read_config();
        const address = normalise_server_url(server_url);
        let config;
        if (credentials !== null && typeof credentials === "object")
            config = await sign_in(address, credentials);
        else if (credentials)
            config = { server_url: address, token: credentials };
        else if (saved !== null && saved.server_url === address)
            config = saved;
        else
            throw new Error("sign in with your name and password");
        if (saved !== null && saved.token !== config.token)
            sign_out(saved);
        stop_background_sync();
        const database = options.database();
        set_status({ state: "syncing", server_url: config.server_url, user: config.user ?? "", error: "" });
        try {
            if (direction === "download") {
                const snapshot = await request_server(config, paths.snapshot);
                await storage.back_up_before_download();
                engine.write_state(database, { site: crypto.randomUUID() });
                engine.replace_with_snapshot(database, snapshot.changes);
                engine.write_state(database, { server_generation: snapshot.generation, pulled_seq: snapshot.cursor, pushed_seq: engine.read_state(database).last_seq });
            }
            else {
                engine.write_state(database, { site: crypto.randomUUID() });
                const snapshot = engine.collect_snapshot(database);
                const response = await request_server(config, paths.replace, { changes: snapshot.changes });
                engine.write_state(database, { server_generation: response.generation, pulled_seq: response.cursor, pushed_seq: snapshot.up_to_seq });
            }
        }
        catch (error) {
            record_failure(error);
            throw error;
        }
        storage.write_config(config);
        set_status({ state: "idle", last_synced_at: new Date().toISOString(), error: "" });
        if (direction === "download")
            options.on_remote_change?.();
        start_background_sync();
        return get_status();
    }
    // Stops syncing, signs out and forgets the server; the data on this device stays as it is.
    function disconnect() {
        stop_background_sync();
        const saved = storage.read_config();
        if (saved !== null)
            sign_out(saved);
        storage.remove_config();
        engine.write_state(options.database(), { server_generation: "" });
        status = { ...off };
        options.on_status?.(get_status());
        return get_status();
    }
    // ── Background ───────────────────────────────────────────────────────────
    // Local changes go out within seconds, but a device that cannot reach the server waits a while before trying again.
    function sync_soon() {
        if (Date.now() - last_failure_at < retry_after_failure_ms)
            return;
        void sync_now().then(() => {
            if (status.state === "offline" || status.state === "failed")
                last_failure_at = Date.now();
        });
    }
    function check_local_changes() {
        if (engine.has_unpushed_changes(options.database()))
            sync_soon();
    }
    async function follow_server_events(config, stream) {
        const response = await do_fetch(new URL(paths.events, config.server_url), { headers: { authorization: `Bearer ${config.token}` }, signal: stream.signal });
        if (!response.ok || !response.body)
            throw new Error(`event stream answered ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                return;
            buffer += decoder.decode(value, { stream: true });
            let end;
            while ((end = buffer.indexOf("\n\n")) >= 0) {
                const block = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                const event = /^event: (.*)$/m.exec(block)?.[1];
                const data = /^data: (.*)$/m.exec(block)?.[1] ?? "";
                if (event === hello_event) {
                    event_client_id = data;
                    last_failure_at = 0;
                    sync_soon();
                }
                if (event === changed_event)
                    sync_soon();
            }
        }
    }
    function keep_following_server_events(config) {
        const stream = new AbortController();
        event_stream = stream;
        void follow_server_events(config, stream)
            .catch(() => undefined)
            .finally(() => {
            event_client_id = "";
            if (event_stream === stream)
                timers.push(setTimeout(() => keep_following_server_events(config), event_stream_retry_ms));
        });
    }
    function start_background_sync() {
        const config = storage.read_config();
        if (!config)
            return;
        timers.push(setInterval(check_local_changes, local_check_ms), setInterval(() => void sync_now(), full_sync_ms));
        keep_following_server_events(config);
    }
    function stop_background_sync() {
        for (const timer of timers)
            clearTimeout(timer);
        timers = [];
        event_stream?.abort();
        event_stream = null;
    }
    // Starts syncing with the saved server, if there is one, and brings in what changed while the app was closed.
    function start() {
        const config = storage.read_config();
        if (!config)
            return;
        set_status({ server_url: config.server_url, user: config.user ?? "" });
        if (engine.read_state(options.database()).server_generation === "")
            return ask_which_copy_to_keep("this device has not synced since a restore");
        set_status({ state: "idle" });
        start_background_sync();
        void sync_now();
    }
    return { start, stop: stop_background_sync, sync_now, connect, disconnect, get_status };
}
