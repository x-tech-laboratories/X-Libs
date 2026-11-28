// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { read_picked, save_text } from "../src/web/files.ts";

function picked(files: File[]): { currentTarget: HTMLInputElement } {
  const input = document.createElement("input");
  input.type = "file";
  Object.defineProperty(input, "files", { value: files });
  return { currentTarget: input };
}

afterEach(() => vi.restoreAllMocks());

describe("files the page reads and saves", () => {
  it("hands on the picked file's text, and nothing when none was picked", async () => {
    expect(await read_picked(picked([new File(['{"app":"x-test"}'], "settings.json")]))).toBe('{"app":"x-test"}');
    expect(await read_picked(picked([]))).toBeNull();
  });

  it("offers text to save under the name given", () => {
    const blobs: Blob[] = [];
    const create = vi.fn((blob: Blob) => (blobs.push(blob), "blob:saved"));
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });

    save_text("x-test-settings.json", "{}");
    save_text("titles.csv", "id\n", "text/csv");
    expect(clicked).toEqual(["x-test-settings.json", "titles.csv"]);
    expect(blobs.map((blob) => blob.type)).toEqual(["application/json", "text/csv"]);
    expect(revoke).toHaveBeenCalledWith("blob:saved");
  });
});
