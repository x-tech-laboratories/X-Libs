// Builds elements without innerHTML, so names from hosts and logs are always shown as text, and joins class names.

// ── Classes ──────────────────────────────────────────────────────────────────

export type ClassValue = string | false | null | undefined;

// Joins the class names that are set, so conditional classes read as one expression.
export function cx(...names: ClassValue[]): string {
  return names.filter(Boolean).join(" ");
}

// ── Elements ─────────────────────────────────────────────────────────────────

export type Child = Node | string | number | null | undefined | false | Child[];

type Attributes = Record<string, string | number | boolean | EventListener | null | undefined>;

export function h<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, attributes: Attributes = {}, ...children: Child[]): HTMLElementTagNameMap[Tag] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") element.addEventListener(name.replace(/^on/, ""), value);
    else if (value === true) element.setAttribute(name, "");
    else element.setAttribute(name, String(value));
  }
  element.append(...nodes(children));
  return element;
}

// The nodes a child stands for, with lists flattened and the empty values dropped.
export function nodes(children: Child): (Node | string)[] {
  if (!Array.isArray(children)) children = [children];
  return children.flatMap((child): (Node | string)[] => {
    if (Array.isArray(child)) return nodes(child);
    if (child === null || child === undefined || child === false) return [];
    return [child instanceof Node ? child : String(child)];
  });
}
