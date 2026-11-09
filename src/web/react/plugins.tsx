// The page's side of a plugin host: slots that draw what plugins put in them, their commands as shortcuts and menu items,
// and a settings section that turns each plugin on or off and edits its settings. A slot's contents are each kept behind
// react-error-boundary, chosen because React still catches render errors only in a class, which this library does not write.

import { useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import type { PluginApi, PluginHost, PluginState, PluginStatus, SettingField, SettingValue } from "../../plugins.ts";
import type { MenuItem } from "../menus.ts";
import { StateBadge, type Tone } from "./badges.tsx";
import { CommitInput, Select, Switch } from "./controls.tsx";
import { SettingRow, SettingsGroup } from "./layout.tsx";
import { describe_keys, use_shortcuts } from "./shortcuts.ts";

export type { Plugin, PluginApi, PluginHost, PluginStatus } from "../../plugins.ts";

// Redraws the component whenever a plugin starts, stops or changes its settings, and returns every plugin's status.
export function use_plugins<Api extends PluginApi>(host: PluginHost<Api>): PluginStatus[] {
  useSyncExternalStore(host.watch.subscribe, host.watch.version);
  return host.list();
}

// ── Slots ────────────────────────────────────────────────────────────────────

type SlotsWithProps<Api extends PluginApi> = {
  [Slot in keyof NonNullable<Api["slots"]> & string]: NonNullable<Api["slots"]>[Slot] extends ComponentType<infer _Props> ? Slot : never;
}[keyof NonNullable<Api["slots"]> & string];

type PropsOf<Api extends PluginApi, Slot extends keyof NonNullable<Api["slots"]>> = NonNullable<Api["slots"]>[Slot] extends ComponentType<infer Props> ? Props : never;

interface PluginSlotProps<Api extends PluginApi, Slot extends SlotsWithProps<Api>> {
  host: PluginHost<Api>;
  name: Slot;
  props: PropsOf<Api, Slot>;
  // Drawn when no running plugin fills the slot.
  empty?: ReactNode;
  // Told when one plugin's part fails to draw; that part alone is left out.
  on_error?: (plugin_id: string, error: unknown) => void;
}

// Draws each component running plugins put in the slot, in the order they started.
export function PluginSlot<Api extends PluginApi, Slot extends SlotsWithProps<Api>>({ host, name, props, empty = null, on_error }: PluginSlotProps<Api, Slot>) {
  use_plugins(host);
  const parts = host.slot(name) as { plugin_id: string; value: ComponentType<PropsOf<Api, Slot>> }[];
  if (parts.length === 0) return <>{empty}</>;
  return (
    <>
      {parts.map(({ plugin_id, value: Part }, index) => (
        <ErrorBoundary key={`${plugin_id}:${index}`} fallback={null} onError={(error) => on_error?.(plugin_id, error)}>
          <Part {...(props as PropsOf<Api, Slot> & object)} />
        </ErrorBoundary>
      ))}
    </>
  );
}

// ── Commands ─────────────────────────────────────────────────────────────────

// Binds every running plugin's command that has keys while the component is shown.
export function use_plugin_shortcuts<Api extends PluginApi>(host: PluginHost<Api>): void {
  use_plugins(host);
  use_shortcuts(host.commands().filter((command) => command.keys).map((command) => ({ keys: command.keys!, run: () => void command.run() })));
}

// The running plugins' commands as menu items, their keys as the hint.
export function plugin_menu_items<Api extends PluginApi>(host: PluginHost<Api>): MenuItem[] {
  return host.commands().map((command) => ({ label: command.label, hint: command.keys && describe_keys(command.keys), run: () => void command.run() }));
}

// ── Settings ─────────────────────────────────────────────────────────────────

const STATE_LABELS: Record<PluginState, [string, Tone]> = {
  running: ["On", "good"],
  off: ["Off", "none"],
  waiting: ["Waiting", "warn"],
  failed: ["Failed", "bad"],
  unsupported: ["Unsupported", "bad"],
};

// One settings group per plugin, for a SettingsPage section such as "Plugins".
export function PluginSettings<Api extends PluginApi>({ host, empty = "No plugins are installed." }: { host: PluginHost<Api>; empty?: ReactNode }) {
  const statuses = use_plugins(host);
  if (statuses.length === 0) return <p className="setting-hint">{empty}</p>;
  return (
    <>
      {statuses.map(({ manifest, state, problem }) => (
        <SettingsGroup
          key={manifest.id}
          heading={<>{manifest.name} <span className="setting-hint">{manifest.version}</span> <StateBadge labels={STATE_LABELS} state={state} title={problem} /></>}
          hint={problem ?? manifest.description}
        >
          <SettingRow label="Turned on" as_label>
            <Switch
              label={`Turn ${manifest.name} on`}
              checked={state !== "off" && state !== "unsupported"}
              disabled={state === "unsupported"}
              on_change={(on) => (on ? host.enable(manifest.id) : host.disable(manifest.id))}
            />
          </SettingRow>
          {(manifest.settings ?? []).map((field) => (
            <SettingRow key={field.key} label={field.label} hint={field.hint} as_label={field.type !== "choice"}>
              <SettingControl field={field} value={host.settings(manifest.id)[field.key] ?? field.default} on_change={(value) => void host.set_settings(manifest.id, { [field.key]: value })} />
            </SettingRow>
          ))}
        </SettingsGroup>
      ))}
    </>
  );
}

function SettingControl({ field, value, on_change }: { field: SettingField; value: SettingValue; on_change: (value: SettingValue) => void }) {
  switch (field.type) {
    case "switch":
      return <Switch label={field.label} checked={value === true} on_change={(on) => on_change(on)} />;
    case "choice":
      return <Select bare label={field.label} options={field.choices.map((choice) => [choice.value, choice.label])} value={String(value)} on_change={on_change} />;
    case "number":
      return (
        <CommitInput type="number" value={Number(value)} min={field.min} max={field.max} step={field.step}
          on_commit={(event) => { const next = event.currentTarget.valueAsNumber; if (Number.isFinite(next)) on_change(next); }} />
      );
    case "text":
      return <CommitInput type="text" value={String(value)} placeholder={field.placeholder} on_commit={(event) => on_change(event.currentTarget.value)} />;
  }
}
