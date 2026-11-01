import assert from "node:assert/strict";

// The display pipeline only needs ImageData. Exercise it without a browser,
// WebGL context, filesystem fixtures or access to any real client preferences.
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const storage = new Map();
const events = [];
let writes = 0, failWrites = false;
const eventTarget = new EventTarget();
eventTarget.addEventListener("rhine-model-image-style", event => events.push(event.detail));
Object.defineProperty(globalThis, "window", { configurable: true, value: eventTarget });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => {
    if (failWrites) throw new Error("Fixture storage quota exceeded");
    writes++;
    storage.set(key, value);
  },
} });

try {
  const { getModelImageStyle, setModelImageStyle, modelImageStyles, applyModelImageStyle } = await import("../src/model-image-style.ts");
  assert.equal(getModelImageStyle("picture-a"), "original");
  setModelImageStyle("picture-a", "duotone");
  assert.equal(getModelImageStyle("picture-a"), "duotone");
  assert.deepEqual(events, [{ id: "picture-a", style: "duotone" }]);
  const storageKey = [...storage.keys()][0];
  const saved = storage.get(storageKey);
  const firstWrites = writes;
  setModelImageStyle("picture-a", "duotone");
  assert.equal(events.length, 1, "same-value choices do not request new image work");
  assert.equal(writes, firstWrites, "same-value choices do not rewrite preferences");
  assert.equal(storage.get(storageKey), saved);

  for (const invalid of ["rainbow", "", null, undefined, {}]) setModelImageStyle("picture-a", invalid);
  for (const invalid of ["", "x".repeat(161), null, undefined]) setModelImageStyle(invalid, "linework");
  assert.equal(events.length, 1, "invalid style or document IDs are ignored");
  assert.equal(getModelImageStyle("picture-a"), "duotone");
  setModelImageStyle("picture-a", "original");
  assert.equal(getModelImageStyle("picture-a"), "original");
  assert.deepEqual(JSON.parse(storage.get(storageKey)), [], "original is the implicit default");

  for (let index = 0; index < 280; index++) setModelImageStyle(`picture-${index}`, "linework");
  assert.equal(JSON.parse(storage.get(storageKey)).length, 256, "saved document preferences remain bounded");
  assert.equal(getModelImageStyle("picture-0"), "original", "old inactive preferences can be evicted");
  assert.equal(getModelImageStyle("picture-279"), "linework", "the latest choice is retained");
  failWrites = true;
  assert.doesNotThrow(() => setModelImageStyle("quota-fixture", "halftone"));
  assert.equal(getModelImageStyle("quota-fixture"), "halftone", "storage failure preserves the current session");
  assert.deepEqual(events.at(-1), { id: "quota-fixture", style: "halftone" });
  failWrites = false;

  storage.set(storageKey, JSON.stringify([
    ["valid-stored", "halftone"], ["invalid-stored", "rainbow"],
    ["x".repeat(161), "duotone"], [null, "linework"], "invalid row",
  ]));
  const reloaded = await import("../src/model-image-style.ts?stored-validation");
  assert.equal(reloaded.getModelImageStyle("valid-stored"), "halftone");
  assert.equal(reloaded.getModelImageStyle("invalid-stored"), "original");
  storage.set(storageKey, "{ malformed JSON");
  const corrupt = await import("../src/model-image-style.ts?malformed-json");
  assert.equal(corrupt.getModelImageStyle("picture-a"), "original");
  storage.set(storageKey, " ".repeat(65537));
  const oversized = await import("../src/model-image-style.ts?oversized-storage");
  assert.equal(oversized.getModelImageStyle("picture-a"), "original");

  const width = 31, height = 29;
  const original = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    original[offset] = x * 8;
    original[offset + 1] = y * 8;
    original[offset + 2] = x < 16 ? 30 : 230;
    original[offset + 3] = y < 22 && x > 3 && x < 27 ? (x % 4 ? 255 : 128) : 0;
  }
  const sourceBefore = original.slice();
  const results = [];
  for (const { value: style } of modelImageStyles) {
    let displayed = original.slice(), canvasReads = 0, canvasWrites = 0;
    const canvas = { width, height, getContext: () => ({
      getImageData: () => { canvasReads++; return { data: displayed.slice() }; },
      putImageData: image => { canvasWrites++; displayed = image.data; },
    }) };
    applyModelImageStyle(canvas, style);
    assert.equal(canvas.width, width);
    assert.equal(canvas.height, height);
    for (let offset = 0; offset < original.length; offset += 4) {
      assert.equal(displayed[offset + 3], original[offset + 3], `${style} preserves every source alpha value`);
      if (!original[offset + 3]) assert.deepEqual(displayed.subarray(offset, offset + 4), original.subarray(offset, offset + 4), `${style} leaves transparent margins untouched`);
    }
    if (style === "original") {
      assert.deepEqual(displayed, original, "original mode preserves all source pixels");
      assert.equal(canvasReads, 0);
      assert.equal(canvasWrites, 0);
    } else {
      assert.notDeepEqual(displayed, original, `${style} changes visible image data`);
      assert.equal(canvasWrites, 1, "derived pixels are committed once");
    }
    results.push(Buffer.from(displayed).toString("base64"));
  }
  assert.equal(new Set(results).size, 4, "all four image styles produce distinct results");
  assert.deepEqual(original, sourceBefore, "the source buffer is never modified");
  console.log("Model image styles: original pixels, alpha/letterbox preservation, distinct styles, validated/bounded preferences, event deduplication and storage failure passed.");
} finally {
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else delete globalThis.localStorage;
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else delete globalThis.window;
}
