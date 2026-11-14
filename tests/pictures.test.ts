// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { shrink_picture } from "../src/web/pictures.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// jsdom cannot decode or draw, so the bitmap has a set size and the canvas reports how it was drawn.
function stub_drawing(width: number, height: number) {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => (blob.type.startsWith("image/") ? { width, height, close } : Promise.reject(new Error("bad")))));
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: draw } as never);
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement, type?: string) {
    return `data:${type};${this.width}x${this.height}`;
  });
  return { close, draw, encode };
}

describe("shrink picture", () => {
  it("scales the longest side down to the limit, keeping the shape, as WebP", async () => {
    const { close, draw, encode } = stub_drawing(1200, 800);
    expect(await shrink_picture(new Blob(["x"], { type: "image/jpeg" }))).toBe("data:image/webp;480x320");
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 480, 320);
    expect(encode).toHaveBeenCalledWith("image/webp", 0.82);
    expect(close).toHaveBeenCalled();
  });

  it("keeps a small picture's size and takes another limit and format", async () => {
    stub_drawing(100, 300);
    expect(await shrink_picture(new Blob(["x"], { type: "image/png" }))).toBe("data:image/webp;100x300");
    expect(await shrink_picture(new Blob(["x"], { type: "image/png" }), { largest_side: 60, type: "image/jpeg", quality: 0.5 })).toBe("data:image/jpeg;20x60");
  });

  it("reads a data URL, and says plainly when a file is not a picture", async () => {
    stub_drawing(640, 640);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { headers: { "content-type": "image/png" } })));
    expect(await shrink_picture("data:image/png;base64,AAAA")).toBe("data:image/webp;480x480");
    await expect(shrink_picture(new Blob(["x"], { type: "text/plain" }))).rejects.toThrow("not a picture this device can read");
  });
});
