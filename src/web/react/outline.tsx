// An outline of a long page's sections beside them, such as a settings page's or an article's headings: each link jumps
// to its section, and the one being read is marked as the page scrolls.

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface OutlineItem {
  // The id of the element the link jumps to.
  target: string;
  label: ReactNode;
  // How deep the item sits, such as 3 for a third-level heading under a second-level one; set as data-level.
  level?: number;
}

export interface OutlineGroup {
  // A heading over the group's links, such as a settings category.
  heading?: ReactNode;
  items: OutlineItem[];
}

interface OutlineProps {
  groups: OutlineGroup[];
  // The outline's name for screen readers, such as "On this page".
  label: string;
  // The class of the outline, and the start of its parts' classes: "-category", "-heading" and "-link".
  class_name?: string;
  // Puts the section jumped to in the address, for a page that does not keep its own route in the hash.
  update_hash?: boolean;
}

// How far below the top of the outline a section's heading may sit and still count as the one being read.
const CURRENT_SECTION_SLACK_PX = 48;

// How long a jump from the outline may take before the outline follows scrolling again.
const JUMP_TIMEOUT_MS = 1000;

export function Outline({ groups, label, class_name = "outline", update_hash = false }: OutlineProps) {
  const targets = groups.flatMap((group) => group.items.map((item) => item.target));
  const [current_target, set_current_target] = useState<string | undefined>(targets[0]);
  const outline = useRef<HTMLElement>(null);
  const is_jumping = useRef(false);
  const jump_timer = useRef<number>(undefined);
  const targets_key = targets.join(" ");

  useEffect(() => {
    // The section being read is the last one whose heading has reached the top of the outline, or the last one once scrolled to the end.
    function follow_scroll(event: Event): void {
      if (is_jumping.current || !outline.current || outline.current.contains(event.target as Node)) return;
      const top = outline.current.getBoundingClientRect().top + CURRENT_SECTION_SLACK_PX;
      const scroller = event.target instanceof Element ? event.target : document.scrollingElement;
      const is_at_end = scroller !== null && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;

      let reached = targets[0];
      for (const target of targets) {
        const element = document.getElementById(target);
        if (element && element.getBoundingClientRect().top <= top) reached = target;
      }
      set_current_target(is_at_end ? targets.at(-1) : reached);
    }

    function end_jump(): void {
      is_jumping.current = false;
    }

    document.addEventListener("scroll", follow_scroll, { capture: true, passive: true });
    document.addEventListener("scrollend", end_jump, { capture: true });
    return () => {
      document.removeEventListener("scroll", follow_scroll, { capture: true });
      document.removeEventListener("scrollend", end_jump, { capture: true });
      window.clearTimeout(jump_timer.current);
    };
  }, [targets_key]);

  // An outline taller than the window scrolls itself to keep the current section's link in view.
  useEffect(() => {
    const nav = outline.current;
    const link = nav?.querySelector<HTMLElement>("[aria-current]");
    if (!nav || !link) return;
    if (link.offsetTop < nav.scrollTop) nav.scrollTop = link.offsetTop;
    else if (link.offsetTop + link.offsetHeight > nav.scrollTop + nav.clientHeight) nav.scrollTop = link.offsetTop + link.offsetHeight - nav.clientHeight;
  }, [current_target]);

  function jump_to(target: string): void {
    set_current_target(target);
    is_jumping.current = true;
    window.clearTimeout(jump_timer.current);
    jump_timer.current = window.setTimeout(() => (is_jumping.current = false), JUMP_TIMEOUT_MS);
    document.getElementById(target)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    if (update_hash) history.replaceState(history.state, "", `#${target}`);
  }

  return (
    <nav ref={outline} className={class_name} aria-label={label}>
      {groups.map((group, index) => (
        <div key={index} className={`${class_name}-category`}>
          {group.heading !== undefined && <span className={`${class_name}-heading`}>{group.heading}</span>}
          {group.items.map((item) => (
            <a
              key={item.target}
              href={`#${item.target}`}
              className={`${class_name}-link`}
              data-level={item.level}
              aria-current={item.target === current_target ? "location" : undefined}
              onClick={(event) => {
                event.preventDefault();
                jump_to(item.target);
              }}
            >
              {item.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}
