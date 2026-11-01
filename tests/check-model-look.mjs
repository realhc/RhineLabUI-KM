import assert from "node:assert/strict";
import { defaultModelLook, normalizeModelLook, normalizeModelLookColor, modelLookKey, modelLookColor, parseModelLook } from "../src/model-look.ts";
import { parsePreferencesTransfer } from "../src/preferences-transfer.ts";

const base = defaultModelLook();
assert.equal(base.mode, "original");
assert.equal(base.coating, "natural");
assert.equal(base.favoriteEnabled, false);
assert.equal(modelLookColor(base, { id: "archive-a", category: "研究" }, true), null, "default appearance leaves every material untouched");
const another = defaultModelLook();
base.palette[0] = "#000000";
assert.notEqual(another.palette[0], base.palette[0], "default palettes do not share mutable arrays");
const input = { ...another, palette: ["#ABC", "#123456", "#DEF"] };
const normalized = normalizeModelLook(input);
assert.deepEqual(normalized.palette, ["#aabbcc", "#123456", "#ddeeff"]);
input.palette[0] = "#FFFFFF";
assert.equal(normalized.palette[0], "#aabbcc", "normalization snapshots palette values");
assert.equal(normalizeModelLookColor(" #ABc "), "#aabbcc");
for (const value of ["red", "transparent", "#fff0", "#11223344", "#fff;position:fixed", "url(secret)", null, undefined, 42])
  assert.equal(normalizeModelLookColor(value), undefined, "only opaque hexadecimal colors are accepted");
for (const value of [null, undefined, [], false, 42]) assert.deepEqual(normalizeModelLook(value), defaultModelLook());
assert.deepEqual(normalizeModelLook({ palette: ["#123456", "bad", "#ffffff"] }).palette, another.palette);
assert.equal(normalizeModelLook({ strength: 5 }).strength, 1);
assert.equal(normalizeModelLook({ strength: -5 }).strength, 0);
assert.equal(normalizeModelLook({ strength: NaN }).strength, another.strength);
assert.equal(normalizeModelLook({ favoriteEnabled: "true", mode: "broken", coating: "broken" }).favoriteEnabled, false);

const solid = normalizeModelLook({ mode: "solid", color: "#ABC", favoriteEnabled: true, favoriteColor: "#DEF" });
assert.equal(modelLookColor(solid, { id: "archive-a" }, false), "#aabbcc");
assert.equal(modelLookColor(solid, { id: "archive-a" }, true), "#ddeeff", "saved color takes priority over ordinary colors");
assert.equal(modelLookColor(solid, { id: "EMPTY-1", placeholder: true }, true), null, "empty exhibit slots never become saved documents");
const colored = normalizeModelLook({ mode: "palette" });
const docs = Array.from({ length: 100 }, (_, i) => ({ id: "archive-" + i, category: "材料研究" }));
const colors = docs.map(doc => modelLookColor(colored, doc, false));
assert(new Set(colors).size >= 3, "multicolor mode has visible variation across documents");
assert(colors.every(color => colored.palette.includes(color)));
assert.deepEqual(docs.slice().reverse().map(doc => modelLookColor(colored, doc, false)).reverse(), colors, "reordering files never changes their colors");
assert.equal(modelLookColor(colored, { id: "e\u0301", category: "e\u0301" }), modelLookColor(colored, { id: "é", category: "é" }), "Unicode identities normalize consistently");
assert.equal(modelLookKey(normalizeModelLook({ ...colored, unexpected: true })), modelLookKey(colored), "unknown fields do not affect rendering identity");
assert.notEqual(modelLookKey(colored), modelLookKey({ ...colored, coating: "metal" }));

const legacy = parsePreferencesTransfer(JSON.stringify({ version: 1, settings: { sound: false }, saved: [] }));
assert.deepEqual(legacy.settings, { sound: false }, "older preference files remain valid");
const imported = parsePreferencesTransfer(JSON.stringify({ version: 1, settings: { modelLook: { mode: "palette", palette: ["#123", "#456", "#789"], ignored: "never merged" } }, saved: ["archive-a"] }));
assert.equal(imported.settings.modelLook.mode, "palette");
assert(!("ignored" in imported.settings.modelLook));
assert.deepEqual(imported.settings.modelLook.palette, ["#112233", "#445566", "#778899"]);
for (const invalid of [null, [], { mode: "invalid" }, { coating: "invalid" }, { color: "#fff;background:red" }, { palette: ["#fff"] }, { palette: Array(9).fill("#fff") }, { strength: -1 }, { strength: 2 }, { strength: "0.5" }, { favoriteEnabled: 1 }, { favoriteColor: "red" }]) {
  assert.throws(() => parseModelLook(invalid));
  assert.throws(() => parsePreferencesTransfer(JSON.stringify({ version: 1, settings: { modelLook: invalid }, saved: [] })), "malformed imported look preferences are rejected");
}
console.log("Model look: unchanged defaults, safe colors, stable multicolor assignment, saved-file priority, owned palettes and strict/legacy preference import passed.");

const perDocument=normalizeModelLook({...solid,documentColors:{"archive-a":"#0090ff"}});
assert.equal(modelLookColor(perDocument,{id:"archive-a"},true),"#0090ff");
assert.equal(modelLookColor(perDocument,{id:"archive-b"},true),solid.favoriteColor);
assert.notEqual(modelLookKey(perDocument),modelLookKey(solid));
assert.throws(()=>parseModelLook({documentColors:{"archive-a":"red"}}));
const named=parsePreferencesTransfer(JSON.stringify({version:1,settings:{displayName:"智识工作室",modelLook:perDocument},saved:[]}));
assert.equal(named.settings.displayName,"智识工作室");
assert.equal(named.settings.modelLook.documentColors["archive-a"],"#0090ff");
