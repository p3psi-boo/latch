import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

type ScreenshotWire = {
  format?: string;
  mimeType?: string;
  base64?: string;
  path?: string;
};

export async function persistScreenshot(data: unknown): Promise<unknown> {
  if (!data || typeof data !== "object") return data;
  const shot = data as ScreenshotWire;
  if (typeof shot.base64 !== "string" || shot.base64.length === 0) return data;
  const format = shot.format === "jpeg" ? "jpeg" : "png";
  const mimeType = shot.mimeType ?? (format === "jpeg" ? "image/jpeg" : "image/png");
  const target =
    typeof shot.path === "string" && shot.path.trim()
      ? shot.path
      : join(tmpdir(), "latch-screenshots", `shot-${Date.now()}.${format === "jpeg" ? "jpg" : "png"}`);
  const absolute = isAbsolute(target) ? target : join(process.cwd(), target);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, Buffer.from(shot.base64, "base64"));
  return {
    format,
    mimeType,
    path: absolute,
    sizeBytes: Buffer.byteLength(shot.base64, "base64"),
  };
}
