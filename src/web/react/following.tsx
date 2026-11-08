// Output that keeps its newest lines in view as they arrive, unless the reader has scrolled up to read, with a Follow switch.

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type UIEvent } from "react";
import { cx } from "../dom.ts";

// How far above the bottom still counts as at the bottom.
const FOLLOW_SLACK_PIXELS = 8;

export const at_bottom = (element: HTMLElement): boolean => element.scrollTop + element.clientHeight >= element.scrollHeight - FOLLOW_SLACK_PIXELS;

export interface FollowTail<Element extends HTMLElement> {
  ref: RefObject<Element | null>;
  following: boolean;
  set_following: (following: boolean) => void;
  // Goes on the box's onScroll; scrolling up stops following and scrolling back to the end resumes it.
  on_scroll: (event: UIEvent<Element>) => void;
}

// Scrolls the box to its end whenever the dependency changes while following; active false, such as once a run has ended, leaves the scroll alone.
export function use_follow_tail<Element extends HTMLElement>(dependency: unknown, active = true): FollowTail<Element> {
  const ref = useRef<Element>(null);
  const [following, set_following] = useState(true);

  useLayoutEffect(() => {
    const element = ref.current;
    if (following && active && element) element.scrollTop = element.scrollHeight;
  }, [dependency, following, active]);

  const on_scroll = useCallback((event: UIEvent<Element>) => {
    if (!active) return;
    set_following(at_bottom(event.currentTarget));
  }, [active]);

  return { ref, following, set_following, on_scroll };
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
