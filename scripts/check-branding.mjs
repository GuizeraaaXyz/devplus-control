import fs from "node:fs";
import assert from "node:assert/strict";

const flatten = (object, prefix = "") =>
  Object.fromEntries(
    Object.entries(object).flatMap(([key, value]) => {
      const full = prefix ? `${prefix}.${key}` : key;
      return typeof value === "object"
        ? Object.entries(flatten(value, full))
        : [[full, value]];
    }),
  );
const placeholders = (value) =>
  [...value.matchAll(/{{\s*([^}]+)\s*}}/g)].map((m) => m[1].trim()).sort();
for (const locale of fs.readdirSync("locales")) {
  for (const file of fs.readdirSync(`locales/${locale}`)) {
    if (file.endsWith(".json"))
      JSON.parse(fs.readFileSync(`locales/${locale}/${file}`, "utf8"));
  }
}
for (const file of fs.readdirSync("locales/en-US")) {
  const english = flatten(
    JSON.parse(fs.readFileSync(`locales/en-US/${file}`, "utf8")),
  );
  const portuguese = flatten(
    JSON.parse(fs.readFileSync(`locales/pt-BR/${file}`, "utf8")),
  );
  for (const [key, value] of Object.entries(english)) {
    assert.equal(
      typeof portuguese[key],
      "string",
      `${file}: tradução ausente: ${key}`,
    );
    assert.ok(portuguese[key].length, `${file}: tradução vazia: ${key}`);
    assert.deepEqual(
      placeholders(portuguese[key]),
      placeholders(value),
      `${file}: interpoladores: ${key}`,
    );
  }
}
const { build } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const common = flatten(
  JSON.parse(fs.readFileSync("locales/pt-BR/common.json", "utf8")),
);
function checkReferences(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) checkReferences(file);
    else if (/\.tsx?$/.test(file)) {
      for (const match of fs
        .readFileSync(file, "utf8")
        .matchAll(/common:(customUi\.[A-Za-z0-9]+)\b/g)) {
        assert.equal(
          typeof common[match[1]],
          "string",
          `${file}: chave ausente ${match[1]}`,
        );
      }
    }
  }
}
checkReferences("src");
assert.equal(build.productName, "Dev+ Control");
assert.equal(build.appId, "com.dogcode.devplus");
assert.equal(build.publish, null);
assert.equal(build.win.executableName, "Dev+ Control");
for (const file of [
  build.win.icon,
  build.mac.icon,
  build.linux.icon,
  "public/logo.png",
  "public/favicon.ico",
])
  assert.ok(fs.existsSync(file), file);
console.log(
  "JSONs válidos; pt-BR completo; interpoladores preservados; branding e ícones configurados.",
);
