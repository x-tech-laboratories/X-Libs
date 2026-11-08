// A speaker button that opens a volume slider; scrolling over it adjusts the volume and a middle-click mutes.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Popover } from "./menus.tsx";

interface VolumeButtonProps {
  // The volume from 0 to 100.
  volume: number;
  on_change: (volume: number) => void;
  // How far one scroll notch or slider step moves it.
  step?: number;
  label?: string;
}

const speaker_icon = (volume: number): string => volume === 0 ? "🔇" : volume < 34 ? "🔈" : volume < 67 ? "🔉" : "🔊";

export function VolumeButton({ volume, on_change, step = 5, label = "Volume" }: VolumeButtonProps) {
  const [open, set_open] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // The level before muting, so unmuting returns to it.
  const before_mute = useRef(volume || 80);
  // The click that closed the popover by landing on its button must not open it again.
  const closed_at = useRef(0);
  const latest_volume = useRef(volume);
  latest_volume.current = volume;

  function set(next: number): void {
    on_change(Math.max(0, Math.min(100, Math.round(next))));
  }

  function toggle_mute(): void {
    if (latest_volume.current > 0) {
      before_mute.current = latest_volume.current;
      set(0);
    } else {
      set(before_mute.current || 80);
    }
  }

  // React's wheel listener is passive and cannot stop the page scrolling, so this one is attached by hand.
  useEffect(() => {
    const on_wheel = (event: WheelEvent): void => {
      event.preventDefault();
      set(latest_volume.current + (event.deltaY < 0 ? step : -step));
    };
    const button = trigger.current!;
    button.addEventListener("wheel", on_wheel, { passive: false });
    return () => button.removeEventListener("wheel", on_wheel);
  }, [step]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="icon volume-button"
        aria-label={`${label} ${volume}%`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`${label} ${volume}% — scroll to adjust, middle-click to mute`}
        onClick={() => { if (Date.now() - closed_at.current > 300) set_open(!open); }}
        onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); toggle_mute(); } }}
      >{speaker_icon(volume)}</button>

      {open && (
        <Popover anchor={trigger.current} label={label} on_close={() => { closed_at.current = Date.now(); set_open(false); }}>
          <div className="volume-popover">
            <button type="button" className="icon" onClick={toggle_mute} aria-label={volume === 0 ? "Unmute" : "Mute"}>{volume === 0 ? "🔇" : "🔊"}</button>
            <input className="seek input-sm" style={{ "--range-progress": `${volume}%` } as CSSProperties} type="range" min={0} max={100} step={step} value={volume} aria-label={label} onChange={(event) => set(Number(event.currentTarget.value))} />
            <span className="volume-percent">{volume}%</span>
          </div>
        </Popover>
      )}
    </>
  );
}
