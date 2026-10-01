import { createHash } from "node:crypto";
import { lstat, readFile, realpath, readdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// This policy applies only to Vite's generated desktop site. Shared web sources
// and portable user data are never candidates for removal.
export const desktopUnusedPaths = [
  "fonts/novecento",
  "audio/typing-preview.wav",
  "audio/typing-source.json",
  "audio/observatory-preview.mp3",
  "sw.js",
  "pwa-build.json",
  "manifest.webmanifest",
  "update.html",
  "update.js",
  "_headers",
  "_redirects",
  "archives",
  "icons/app-icon.svg",
  "icons/icon-192.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];
export const desktopModelNames = ["archive-cassette", "archive-assembly"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const within = (root, target) => {
  const name = relative(root, target);
  return (
    name !== "" &&
    !isAbsolute(name) &&
    name !== ".." &&
    !name.startsWith(".." + sep)
  );
};

async function siteRoot(project) {
  const root = resolve(project, "release/desktop/site");
  const info = await lstat(root);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (await realpath(root)).toLowerCase() !== root.toLowerCase()
  )
    throw new Error(
      "Desktop output must be a real directory inside this project",
    );
  return root;
}

async function files(root, directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Desktop output cannot contain symlinks: " + path);
    if (entry.isDirectory()) result.push(...(await files(root, path)));
    else
      result.push({
        path: relative(root, path).replaceAll("\\", "/"),
        bytes: (await lstat(path)).size,
      });
  }
  return result;
}

export async function cleanDesktopResources(project = process.cwd()) {
  const root = await siteRoot(project);
  const removed = [];
  const candidates = [...desktopUnusedPaths];
  for (const name of desktopModelNames) {
    const original = resolve(root, `assets/${name}.glb`);
    let bytes;
    try {
      bytes = await readFile(original);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const versioned = resolve(
      root,
      `assets/${name}.${digest(bytes).slice(0, 16)}.glb`,
    );
    if (digest(await readFile(versioned)) !== digest(bytes))
      throw new Error("Versioned model is missing or differs: " + name);
    // Production assetUrl always uses the versioned model; retain its exact bytes.
    candidates.push(`assets/${name}.glb`);
  }
  for (const name of candidates) {
    const path = resolve(root, name);
    if (!within(root, path))
      throw new Error("Desktop cleanup path escapes output");
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (info.isSymbolicLink() || !within(root, await realpath(path)))
      throw new Error("Desktop cleanup cannot follow symlinks");
    if (info.isDirectory()) removed.push(...(await files(root, path)));
    else removed.push({ path: name, bytes: info.size });
    await rm(path, { recursive: info.isDirectory(), force: true });
  }
  return removed;
}

export async function inspectDesktopResources(project = process.cwd()) {
  const root = await siteRoot(project);
  const entries = await files(root);
  const inventory = new Set(entries.map(({ path }) => path));
  for (const name of [
    ...desktopUnusedPaths,
    ...desktopModelNames.map((name) => `assets/${name}.glb`),
  ]) {
    if (
      entries.some(({ path }) => path === name || path.startsWith(name + "/"))
    )
      throw new Error("Unused web resource remains in desktop output: " + name);
  }
  for (const name of [
    "desktop.html",
    "favicon.svg",
    "icons/icon-512.png",
    "fonts/MiSans-license.pdf",
    "fonts/NOTICE.txt",
    "licenses/rolling-number.txt",
    "audio/atmosphere.ogg",
    "audio/motif.ogg",
    "audio/pulse.ogg",
    "audio/README.md",
    "audio/score.json",
    "LICENSE",
    "DESKTOP-LICENSES.md",
    "THIRD-PARTY-NOTICES.txt",
  ])
    if (!inventory.has(name))
      throw new Error("Required desktop resource is missing: " + name);

  const text = await Promise.all(
    entries
      .filter(({ path }) => /\.(js|css|html)$/.test(path))
      .map(async ({ path }) => ({
        path,
        text: await readFile(resolve(root, path), "utf8"),
      })),
  );
  const bundles = text
    .filter(({ path }) => path.endsWith(".js"))
    .map(({ text }) => text)
    .join("\n");
  const models = [];
  for (const name of desktopModelNames) {
    const original = await readFile(
      resolve(project, `public/assets/${name}.glb`),
    );
    const sha256 = digest(original);
    const path = `assets/${name}.${sha256.slice(0, 16)}.glb`;
    if (
      !inventory.has(path) ||
      digest(await readFile(resolve(root, path))) !== sha256 ||
      !bundles.includes(path)
    )
      throw new Error(
        "Desktop model bytes or bundled URL are invalid: " + path,
      );
    models.push({ path, bytes: original.length, sha256 });
  }
  // Check every CSS font/image URL, including Unicode font subsets and KaTeX.
  // Keep fallback font formats too; no glyph coverage or appearance is reduced.
  for (const item of text) {
    const refs = item.path.endsWith(".css")
      ? [...item.text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)].map(
          (match) => match[1],
        )
      : item.path.endsWith(".html")
        ? [...item.text.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(
            (match) => match[1],
          )
        : [];
    for (const ref of refs) {
      if (/^(?:data:|https?:|#)/.test(ref)) continue;
      const cleanRef = decodeURIComponent(ref.split(/[?#]/)[0]);
      const path = cleanRef.startsWith("/")
        ? resolve(root, "." + cleanRef)
        : resolve(dirname(resolve(root, item.path)), cleanRef);
      if (
        !within(root, path) ||
        !inventory.has(relative(root, path).replaceAll("\\", "/"))
      )
        throw new Error(
          "Broken desktop resource reference: " + item.path + " -> " + ref,
        );
    }
  }
  return {
    files: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    models,
  };
}
