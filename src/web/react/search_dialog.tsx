// A search over the app's or site's pages in a dialog: the results come in as the reader types, each page with its
// matching sections under it, and the arrow keys and Enter pick one. SearchButton opens it, also from Ctrl+K or "/".

import DOMPurify from "dompurify";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Dialog } from "./dialog.tsx";
import { is_apple_platform, use_shortcuts } from "./shortcuts.ts";

export interface SearchPart {
  title: string;
  href: string;
  // The matching words in context, as HTML where <mark> picks out the words searched for.
  excerpt?: string;
}

export interface SearchHit extends SearchPart {
  // The page's sections that matched, such as its headings.
  parts?: SearchPart[];
}

export interface SearchLabels {
  title: string;
  placeholder: string;
  // Shown when nothing matched; {query} is the words searched for.
  no_results: string;
  searching: string;
}

const english_labels: SearchLabels = { title: "Search", placeholder: "Type to search", no_results: "Nothing found for “{query}”.", searching: "Searching…" };

interface SearchDialogProps {
  // Finds the hits for the words typed; a rejection shows its message in place of the results.
  search: (query: string) => Promise<SearchHit[]>;
  on_close: () => void;
  // Goes to a hit picked with Enter; the browser follows a clicked one by itself.
  on_open?: (href: string) => void;
  labels?: Partial<SearchLabels>;
  // How long typing must pause before searching.
  delay_in_milliseconds?: number;
}

// Only the <mark> around matched words survives from an excerpt.
function excerpt_html(excerpt: string): string {
  return DOMPurify.sanitize(excerpt, { ALLOWED_TAGS: ["mark"], ALLOWED_ATTR: [] });
}

type Results = { status: "idle" } | { status: "searching" } | { status: "done"; query: string; hits: SearchHit[] } | { status: "failed"; message: string };

export function SearchDialog({ search, on_close, on_open = (href) => location.assign(href), labels, delay_in_milliseconds = 120 }: SearchDialogProps) {
  const words = { ...english_labels, ...labels };
  const [query, set_query] = useState("");
  const [results, set_results] = useState<Results>({ status: "idle" });
  const [active, set_active] = useState(0);
  const latest = useRef(0);
  const list_id = useId();

  useEffect(() => {
    const wanted = query.trim();
    const request = ++latest.current;
    if (wanted === "") {
      set_results({ status: "idle" });
      return;
    }
    set_results((shown) => (shown.status === "done" ? shown : { status: "searching" }));
    const timer = window.setTimeout(() => {
      search(wanted).then(
        (hits) => {
          if (request !== latest.current) return;
          set_results({ status: "done", query: wanted, hits });
          set_active(0);
        },
        (error: unknown) => {
          if (request === latest.current) set_results({ status: "failed", message: error instanceof Error ? error.message : String(error) });
        },
      );
    }, delay_in_milliseconds);
    return () => window.clearTimeout(timer);
  }, [query]);

  const hits = results.status === "done" ? results.hits : [];
  const options = hits.flatMap((hit, hit_index) => [
    { key: `${hit_index}`, part: hit, is_part: false },
    ...(hit.parts ?? []).map((part, part_index) => ({ key: `${hit_index}-${part_index}`, part, is_part: true })),
  ]);
  const option_id = (index: number) => `${list_id}-${index}`;

  function on_key_down(event: KeyboardEvent<HTMLInputElement>): void {
    if (options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (active + step + options.length) % options.length;
      set_active(next);
      document.getElementById(option_id(next))?.scrollIntoView?.({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      on_open(options[active].part.href);
      on_close();
    }
  }

  return (
    <Dialog title={words.title} on_close={on_close} class_name="search-dialog">
      <input
        type="search"
        className="search-dialog-field"
        placeholder={words.placeholder}
        aria-label={words.title}
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={list_id}
        aria-activedescendant={options.length > 0 ? option_id(active) : undefined}
        aria-autocomplete="list"
        autoFocus
        value={query}
        onChange={(event) => set_query(event.target.value)}
        onKeyDown={on_key_down}
      />
      <div className="search-dialog-results" aria-live="polite">
        {results.status === "searching" && <p className="muted">{words.searching}</p>}
        {results.status === "failed" && <p className="muted">{results.message}</p>}
        {results.status === "done" && hits.length === 0 && <p className="muted">{words.no_results.replace("{query}", results.query)}</p>}
        {options.length > 0 && (
          <ul id={list_id} role="listbox" aria-label={words.title} className="search-dialog-list">
            {options.map((option, index) => (
              <li key={option.key} id={option_id(index)} role="option" aria-selected={index === active} className={option.is_part ? "search-dialog-hit part" : "search-dialog-hit"}>
                <a href={option.part.href} tabIndex={-1} onMouseEnter={() => set_active(index)} onClick={() => on_close()}>
                  <span className="search-dialog-title">{option.part.title}</span>
                  {option.part.excerpt && <span className="search-dialog-excerpt" dangerouslySetInnerHTML={{ __html: excerpt_html(option.part.excerpt) }} />}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

// ── Opening it ───────────────────────────────────────────────────────────────

interface SearchButtonProps {
  label: string;
  on_open: () => void;
  // The shortcuts that also open it; Ctrl+K (Cmd+K on Apple devices) and "/" unless given.
  keys?: string[];
}

// A button that looks like a search field, with its shortcut beside the label.
export function SearchButton({ label, on_open, keys = ["mod+k", "/"] }: SearchButtonProps) {
  use_shortcuts(keys.map((keys_text) => ({ keys: keys_text, run: on_open })));
  const [is_apple, set_is_apple] = useState(false);
  useEffect(() => set_is_apple(is_apple_platform()), []);
  return (
    <button type="button" className="search-button" onClick={on_open} aria-keyshortcuts={is_apple ? "Meta+K" : "Control+K"}>
      <svg className="line-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <span className="search-button-label">{label}</span>
      <kbd className="search-button-keys" aria-hidden="true">{is_apple ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}
