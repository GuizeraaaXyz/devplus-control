import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(
  process.argv[2] ?? fileURLToPath(new URL("../", import.meta.url)),
);
const source = path.join(root, "branding/devplus-logo.png");
try {
  await fs.access(source);
} catch {
  console.log(
    "Logo ausente: coloque sua imagem em branding/devplus-logo.png. Recursos atuais preservados.",
  );
  process.exit(0);
}
const sizes = [16, 32, 48, 64, 128, 192, 256, 512, 1024];
const images = new Map();
for (const size of sizes) {
  images.set(
    size,
    await sharp(source)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer(),
  );
}
const icoSizes = [16, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + icoSizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
for (const [index, size] of icoSizes.entries()) {
  const pos = 6 + index * 16;
  header[pos] = header[pos + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, pos + 4);
  header.writeUInt16LE(32, pos + 6);
  header.writeUInt32LE(images.get(size).length, pos + 8);
  header.writeUInt32LE(offset, pos + 12);
  offset += images.get(size).length;
}
const ico = Buffer.concat([
  header,
  ...icoSizes.map((size) => images.get(size)),
]);
const icnsChunks = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
].map(([type, size]) => {
  const chunk = Buffer.alloc(8);
  chunk.write(type);
  chunk.writeUInt32BE(8 + images.get(size).length, 4);
  return Buffer.concat([chunk, images.get(size)]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns");
icnsHeader.writeUInt32BE(
  8 + icnsChunks.reduce((sum, chunk) => sum + chunk.length, 0),
  4,
);
const outputs = new Map([
  ["build/icons/icon.ico", ico],
  ["public/favicon.ico", ico],
  ["build/icons/icon.icns", Buffer.concat([icnsHeader, ...icnsChunks])],
  ["build/icons/icon.png", images.get(512)],
  ["public/logo.png", images.get(512)],
  ["public/icons/web-app-manifest-192x192.png", images.get(192)],
  ["public/icons/web-app-manifest-512x512.png", images.get(512)],
]);
for (const size of sizes)
  outputs.set(`build/icons/devplus-${size}.png`, images.get(size));
outputs.set(
  "build/icons/trayTemplate.png",
  await sharp(images.get(32)).linear([0, 0, 0], [0, 0, 0]).png().toBuffer(),
);
for (const [file, data] of outputs) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), data);
}
console.log(
  "Logo, favicon, ícones Windows, macOS, bandeja e manifesto atualizados.",
);
