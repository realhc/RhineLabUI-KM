import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import {
  cleanDesktopResources,
  inspectDesktopResources,
} from "./desktop-resources.mjs";
// A PNG-compressed ICO is supported by Windows Vista and newer.
await mkdir("desktop", { recursive: true });
const png = await readFile("public/icons/icon-192.png");
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 192;
header[7] = 192;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile("desktop/icon.ico", Buffer.concat([header, png]));
const site = "release/desktop/site";
const removed = await cleanDesktopResources();
await copyFile("LICENSE", `${site}/LICENSE`);
await copyFile("docs/DESKTOP-LICENSES.md", `${site}/DESKTOP-LICENSES.md`);
const notices = [];
const runtimePackages = Object.entries(
  JSON.parse(await readFile("package-lock.json", "utf8")).packages,
)
  .filter(([name, pkg]) => name.startsWith("node_modules/") && !pkg.dev)
  .map(([name]) => name.slice("node_modules/".length));
for (const name of new Set([
  ...runtimePackages,
  "three",
  "@kitlangton/rolling-number",
  "markdown-it",
  "argparse",
  "entities",
  "linkify-it",
  "mdurl",
  "punycode.js",
  "uc.micro",
])) {
  const pkg = JSON.parse(
    await readFile(`node_modules/${name}/package.json`, "utf8"),
  );
  let license;
  for (const file of [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "LICENSE-MIT.txt",
  ]) {
    try {
      license = await readFile(`node_modules/${name}/${file}`, "utf8");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!license) throw new Error(`Missing dependency license: ${name}`);
  notices.push(`${name} ${pkg.version}\n${license}`);
}
await writeFile(
  `${site}/THIRD-PARTY-NOTICES.txt`,
  notices.join("\n\n----------------------------------------\n\n"),
);
const resources = await inspectDesktopResources();
await writeFile(
  "release/desktop/resources.json",
  JSON.stringify({ ...resources, removed }, null, 2) + "\n",
);
console.log(
  `Desktop resources ready: ${resources.files} files, ${(resources.bytes / 1048576).toFixed(1)} MiB; removed ${removed.length} unused build resources (${(removed.reduce((sum, item) => sum + item.bytes, 0) / 1048576).toFixed(1)} MiB).`,
);
