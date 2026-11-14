// Pictures shrunk in the page before an app stores or syncs them, such as a photo from a phone's camera.

export interface ShrinkOptions {
  // The longest side kept in pixels; a smaller picture keeps its size.
  largest_side?: number;
  // The format written, WebP by default since it keeps transparency.
  type?: string;
  // From 0 to 1, for the formats that lose detail.
  quality?: number;
}

// A picture file or URL, such as a data URL, redrawn at most largest_side pixels on its longest side, as a data URL.
export async function shrink_picture(source: Blob | string, { largest_side = 480, type = "image/webp", quality = 0.82 }: ShrinkOptions = {}): Promise<string> {
  const blob = typeof source === "string" ? await (await fetch(source)).blob() : source;
  const bitmap = await createImageBitmap(blob).catch(() => {
    throw new Error("That file is not a picture this device can read.");
  });
  const scale = Math.min(1, largest_side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL(type, quality);
}
