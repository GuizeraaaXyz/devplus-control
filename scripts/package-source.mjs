import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import AdmZip from "adm-zip";

const archive = new AdmZip();
function listSourceFiles(directory = ".") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(directory, entry.name);
    if (
      [
        "node_modules",
        "dist",
        "dist-electron",
        "release-artifacts",
        ".git",
        ".tanstack",
        ".vercel",
        "logs",
        ".idea",
      ].includes(entry.name)
    )
      return [];
    return entry.isDirectory() ? listSourceFiles(file) : [file];
  });
}
let files;
if (fs.existsSync(".git")) {
  files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
} else {
  // The distributed source archive remains buildable without Git metadata.
  files = listSourceFiles();
}
for (const file of new Set(files)) {
  if (
    /^(?:node_modules|dist|dist-electron|release-artifacts|\.git)(?:\/|$)/.test(
      file,
    ) ||
    /(?:^|\/)\.env(?:\.|$)/.test(file) ||
    /\.(?:pem|key|pfx|zip)$/.test(file)
  )
    continue;
  if (fs.existsSync(file) && fs.statSync(file).isFile())
    archive.addLocalFile(
      file,
      path.posix.dirname(file) === "." ? "" : path.posix.dirname(file),
    );
}
fs.mkdirSync("release-artifacts", { recursive: true });
archive.writeZip("public/devplus-source.zip");
fs.copyFileSync(
  "public/devplus-source.zip",
  "release-artifacts/DevPlus-Control-Source.zip",
);
console.log(
  "Código-fonte correspondente incluído na interface e em release-artifacts/DevPlus-Control-Source.zip.",
);
