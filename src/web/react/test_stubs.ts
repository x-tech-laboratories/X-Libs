// Stands in for the native popover and modal dialog, which jsdom does not draw; a test imports it for its side effects.

// A shared setup file may load in a node environment too, where there is no window to stand in for.
if (typeof window !== "undefined") {
  HTMLElement.prototype.showPopover = function (this: HTMLElement) {
    this.setAttribute("data-shown", "");
  };

  HTMLElement.prototype.hidePopover = function (this: HTMLElement) {
    this.removeAttribute("data-shown");
    this.dispatchEvent(Object.assign(new Event("toggle"), { newState: "closed" }));
  };

  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };

  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };

  // jsdom hides every popover, since none ever matches :popover-open, so a shown one is drawn again here over any app rule.
  const shown_popovers = document.createElement("style");
  shown_popovers.textContent = "[popover][data-shown] { display: block !important; }";
  document.head.append(shown_popovers);

  // Media queries all say no and scrolling does nothing, since jsdom lays nothing out.
  window.matchMedia ??= (query: string) =>
    ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList;

  window.scrollTo = () => {};

  // Nothing is ever resized either, so an observer never reports.
  window.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
