import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import assert from "node:assert/strict";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "devplus-brand-"));
try {
  await fs.mkdir(path.join(dir, "branding"));
  await sharp({
    create: {
      width: 120,
      height: 60,
      channels: 4,
      background: { r: 37, g: 99, b: 235, alpha: 1 },
    },
  })
    .png()
    .toFile(path.join(dir, "branding/devplus-logo.png"));
  execFileSync(process.execPath, ["scripts/generate-branding.mjs", dir]);
  for (const size of [16, 32, 64, 128, 256]) {
    const file = path.join(dir, `build/icons/devplus-${size}.png`);
    const meta = await sharp(file).metadata();
    assert.equal(meta.width, size);
    assert.equal(meta.height, size);
    assert.equal(meta.hasAlpha, true);
    const { data, info } = await sharp(file)
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, "Padding must remain transparent");
    assert.ok(
      data[
        (Math.floor(size / 2) * size + Math.floor(size / 2)) * info.channels + 3
      ] > 0,
    );
  }
  const ico = await fs.readFile(path.join(dir, "build/icons/icon.ico"));
  assert.equal(ico.readUInt16LE(4), 6);
  for (let index = 0; index < 6; index++) {
    const pos = 6 + index * 16;
    const offset = ico.readUInt32LE(pos + 12),
      length = ico.readUInt32LE(pos + 8);
    const meta = await sharp(ico.subarray(offset, offset + length)).metadata();
    assert.equal(meta.width, ico[pos] || 256);
  }
  console.log(
    "Conversão validada: proporção, transparência, dimensões PNG e seis resoluções ICO.",
  );
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
