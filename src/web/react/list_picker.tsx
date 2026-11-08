// A dialog that adds one thing to any of the app's lists, such as a video to playlists, and makes a new list for it.

import { useState, type FormEvent } from "react";
import { Badge } from "./badges.tsx";
import { Dialog, open_dialog } from "./dialog.tsx";
import { Empty, Loaded, use_resource } from "./states.tsx";

export interface PickableList {
  id: string;
  name: string;
  // How many things the list holds, shown beside its name.
  count?: number;
  // Whether the thing is in the list already.
  holds: boolean;
}

export interface ListPickerOptions {
  title: string;
  load: () => Promise<PickableList[]>;
  add: (id: string) => Promise<void>;
  // Makes a list with the name and adds the thing to it.
  create: (name: string) => Promise<PickableList>;
  // The new list field's name, such as "New playlist".
  new_label?: string;
  // What shows when there are no lists yet.
  empty_text?: string;
}

export function ListPicker({ options, on_close }: { options: ListPickerOptions; on_close: () => void }) {
  const lists = use_resource(options.load, []);
  const [added, set_added] = useState<PickableList[]>([]);
  const [new_name, set_new_name] = useState("");
  const [busy, set_busy] = useState(false);
  const new_label = options.new_label ?? "New list";

  // Lists added to or made here show as holding the thing without loading them again.
  const shown = (loaded: PickableList[]) => {
    const merged = loaded.map((list) => added.find((other) => other.id === list.id) ?? list);
    return [...merged, ...added.filter((list) => !loaded.some((other) => other.id === list.id))];
  };

  async function add(list: PickableList): Promise<void> {
    set_busy(true);
    try {
      await options.add(list.id);
      set_added((before) => [...before, { ...list, holds: true, count: list.count === undefined ? undefined : list.count + 1 }]);
    } finally {
      set_busy(false);
    }
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = new_name.trim();
    if (!name) return;
    set_busy(true);
    try {
      const list = await options.create(name);
      set_added((before) => [...before, { ...list, holds: true }]);
      set_new_name("");
    } finally {
      set_busy(false);
    }
  }

  return (
    <Dialog title={options.title} on_close={on_close} class_name="list-picker" buttons={<button className="accent solid" onClick={on_close}>Done</button>}>
      <Loaded resource={lists} lines={3}>
        {(loaded) => shown(loaded).length === 0
          ? <Empty title={options.empty_text ?? "No lists yet."} />
          : (
            <ul className="plain-list list-picker-lists">
              {shown(loaded).map((list) => (
                <li key={list.id}>
                  <button type="button" className="list-picker-item" aria-pressed={list.holds} disabled={list.holds || busy} onClick={() => void add(list)}>
                    <span className="list-picker-tick" aria-hidden="true">{list.holds ? "✓" : ""}</span>
                    <span className="list-picker-name">{list.name}</span>
                    {list.count !== undefined && <Badge>{list.count}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </Loaded>
      <form className="list-picker-new" onSubmit={(event) => void create(event)}>
        <input type="text" placeholder={new_label} aria-label={new_label} value={new_name} onChange={(event) => set_new_name(event.currentTarget.value)} />
        <button type="submit" disabled={!new_name.trim() || busy}>Create</button>
      </form>
    </Dialog>
  );
}

// Opens the picker from anywhere, such as a card's menu; the Shell draws it.
export function pick_list_dialog(options: ListPickerOptions): () => void {
  return open_dialog((close) => <ListPicker options={options} on_close={close} />);
}
