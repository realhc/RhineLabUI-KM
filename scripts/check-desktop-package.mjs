import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { inspectDesktopResources } from "./desktop-resources.mjs";

const config = createRequire(import.meta.url)("../forge.config.cjs");
const ignore = config.packagerConfig.ignore;
for (const path of [
  "",
  "/package.json",
  "/LICENSE",
  "/desktop",
  "/desktop/main.mjs",
  "/desktop/preload.cjs",
  "/desktop/repository.mjs",
  "/desktop/directory.mjs",
  "/content",
  "/content/archives.json",
  "/release",
  "/release/desktop",
  "/release/desktop/site",
  "/release/desktop/site/desktop.html",
])
  assert.equal(
    ignore(path),
    false,
    "Runtime package path must be included: " + path,
  );
for (const path of [
  "/src",
  "/public",
  "/node_modules",
  "/RhineLabData",
  "/desktop/icon.ico",
  "/desktop/old-entry.mjs",
  "/content/private.json",
  "/release/desktop/resources.json",
  "/release/packages",
  "/verification",
  "/scripts",
  "/docs",
])
  assert.equal(
    ignore(path),
    true,
    "Non-runtime package path must be excluded: " + path,
  );
const result = await inspectDesktopResources();
console.log("Desktop package resources passed: " + JSON.stringify(result));
