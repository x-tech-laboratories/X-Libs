// Named backups of an app's data: the name says when each was taken and whether it was automatic, and daily ones keep a set number.
export { backup_method_names, default_backup_schedule } from "./backup_protocol.js";
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Names such as tasks-2026-06-10T09-30-00Z-auto.db for the prefix "tasks" and the extension ".db".
export function backup_naming(prefix, extension) {
    const pattern = new RegExp(`^${escaped(prefix)}-(\\d{4}-\\d{2}-\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})Z(-auto)?${escaped(extension)}$`);
    return {
        pattern,
        name_for: (taken_at, is_automatic) => `${prefix}-${taken_at.toISOString().slice(0, 19).replaceAll(":", "-")}Z${is_automatic ? "-auto" : ""}${extension}`,
        describe: (name, size_bytes) => {
            const match = pattern.exec(name);
            if (!match)
                throw new Error(`not a backup name: ${name}`);
            const [, date, hours, minutes, seconds, automatic] = match;
            return { name, taken_at: `${date}T${hours}:${minutes}:${seconds}Z`, is_automatic: automatic !== undefined, size_bytes };
        },
    };
}
const day_in_milliseconds = 24 * 60 * 60 * 1000;
export function backups(naming, store) {
    const list = async () => (await store.list())
        .filter((file) => naming.pattern.test(file.name))
        .map((file) => naming.describe(file.name, file.size_bytes))
        .sort((first, second) => second.taken_at.localeCompare(first.taken_at));
    const remove = async (name) => {
        if (!naming.pattern.test(name))
            throw new Error(`not a backup name: ${name}`);
        await store.remove(name);
    };
    const create = async (is_automatic = false, now = new Date()) => {
        const name = naming.name_for(now, is_automatic);
        const existing = (await list()).find((backup) => backup.name === name);
        return existing ?? naming.describe(name, await store.take(name));
    };
    const keep_automatic = async (to_keep, interval_in_milliseconds = day_in_milliseconds, now = new Date()) => {
        const newest = (await list()).find((backup) => backup.is_automatic);
        if (!newest || now.getTime() - Date.parse(newest.taken_at) >= interval_in_milliseconds)
            await create(true, now);
        const automatic = (await list()).filter((backup) => backup.is_automatic);
        for (const backup of automatic.slice(Math.max(0, to_keep)))
            await remove(backup.name);
    };
    return { naming, list, create: (is_automatic) => create(is_automatic), remove, keep_automatic };
}
// Takes the automatic backups now and on every check; check again after the schedule changes. Returns the function that stops it.
export function keep_backing_up(kept, schedule, options = {}) {
    const on_error = options.on_error ?? ((error) => console.error("automatic backup failed:", error));
    const check = async () => {
        try {
            const { automatic, to_keep } = await schedule();
            if (automatic)
                await kept.keep_automatic(to_keep);
        }
        catch (error) {
            on_error(error);
        }
    };
    void check();
    const timer = setInterval(() => void check(), options.check_every_ms ?? 60 * 60 * 1000);
    return { check, stop: () => clearInterval(timer) };
}
