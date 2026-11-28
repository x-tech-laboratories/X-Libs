// Output that keeps its newest lines in view as they arrive, unless the reader has scrolled up to read, with a Follow
// switch; the hook under it follows any scrolling box, such as a conversation, and a nested one should set
// overscroll-behavior: contain so its scrolling stays inside it.

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type UIEvent } from "react";
import { cx } from "../dom.ts";

// How far above the bottom still counts as at the bottom.
const FOLLOW_SLACK_PIXELS = 8;

export const at_bottom = (element: HTMLElement): boolean => element.scrollTop + element.clientHeight >= element.scrollHeight - FOLLOW_SLACK_PIXELS;

export interface FollowTail<Element extends HTMLElement> {
  ref: RefObject<Element | null>;
  following: boolean;
  set_following: (following: boolean) => void;
  // Goes on the box's onScroll; only the reader scrolling up stops following, and coming back to the end resumes it.
  on_scroll: (event: UIEvent<Element>) => void;
  // Scrolls to the end and follows from there, as a "Jump to latest" button does.
  jump: () => void;
}

// Scrolls the box to its end whenever the dependency changes while following; active false, such as once a run has
// ended, leaves the scroll alone. Content growing, or the box's own scroll landing short of the end as it grows, never
// stops the following, since only a scroll upward does.
export function use_follow_tail<Element extends HTMLElement>(dependency: unknown, active = true): FollowTail<Element> {
  const ref = useRef<Element>(null);
  const [following, set_following] = useState(true);
  const last_top = useRef(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (following && active) element.scrollTop = element.scrollHeight;
    last_top.current = element.scrollTop;
  }, [dependency, following, active]);

  const on_scroll = useCallback((event: UIEvent<Element>) => {
    const element = event.currentTarget;
    if (active) {
      if (at_bottom(element)) set_following(true);
      else if (element.scrollTop < last_top.current) set_following(false);
    }
    last_top.current = element.scrollTop;
  }, [active]);

  const jump = useCallback(() => {
    const element = ref.current;
    if (element) element.scrollTop = element.scrollHeight;
    set_following(true);
  }, []);

  return { ref, following, set_following, on_scroll, jump };
}

interface FollowToggleProps {
  following: boolean;
  on_change: (following: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function FollowToggle({ following, on_change, disabled = false, label = "Follow" }: FollowToggleProps) {
  return (
    <label className="follow-toggle">
      <input type="checkbox" checked={following} disabled={disabled} onChange={(event) => on_change(event.currentTarget.checked)} /> {label}
    </label>
  );
}

interface FollowingOutputProps {
  text: string;
  // Whether new text is still arriving; the Follow switch and the following only work while it is.
  active?: boolean;
  // Shows the Follow switch above the output.
  toggle?: boolean;
  class_name?: string;
  // Drawn beside the Follow switch, such as filter chips.
  tools?: ReactNode;
}

// Streamed text in an output box that follows its tail.
export function FollowingOutput({ text, active = true, toggle = false, class_name, tools }: FollowingOutputProps) {
  const tail = use_follow_tail<HTMLPreElement>(text, active);
  const output = <pre ref={tail.ref} className={cx("output", "following-output", class_name)} onScroll={tail.on_scroll}>{text}</pre>;
  if (!toggle && tools === undefined) return output;
  return (
    <div className="following">
      <div className="following-tools">
        {tools}
        {toggle && <FollowToggle following={tail.following} on_change={tail.set_following} disabled={!active} />}
      </div>
      {output}
    </div>
  );
}
