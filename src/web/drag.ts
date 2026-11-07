// What a drag shows under the pointer.

// Shows a small badge such as "3 tasks" under the pointer as the drag image, in place of a picture of the grabbed row.
export function set_drag_badge(event: { dataTransfer: DataTransfer | null }, label: string, class_name = "drag-badge"): void {
  if (!event.dataTransfer) return;
  const badge = document.createElement("div");
  badge.className = class_name;
  badge.textContent = label;
  document.body.append(badge);
  event.dataTransfer.setDragImage(badge, -12, -12);
  // The browser takes its picture of the badge during this event, so it can go once the event is over.
  setTimeout(() => badge.remove(), 0);
}
