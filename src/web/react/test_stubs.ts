// Stands in for the native popover and modal dialog, which jsdom does not draw; a test imports it for its side effects.

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

// jsdom hides every popover, since none ever matches :popover-open, so a shown one is drawn again here.
const shown_popovers = document.createElement("style");
shown_popovers.textContent = "[popover][data-shown] { display: block; }";
document.head.append(shown_popovers);
