export const modelImageStyles = [
  { value: "original", label: "原图" },
  { value: "duotone", label: "双色" },
  { value: "halftone", label: "网点" },
  { value: "linework", label: "线稿" },
] as const;
export type ModelImageStyle = (typeof modelImageStyles)[number]["value"];

const STORAGE_KEY = "rhine-model-image-styles";
const MAX_STYLES = 256;
const MAX_ID_LENGTH = 160;
let preferences: Map<string, ModelImageStyle> | undefined;
export function isModelImageStyle(value: unknown): value is ModelImageStyle {
  return modelImageStyles.some(style => style.value === value);
}
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH;
function styles() {
  if (preferences) return preferences;
  preferences = new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 65536) return preferences;
    const stored: unknown = JSON.parse(raw);
    if (Array.isArray(stored)) for (const item of stored.slice(-MAX_STYLES)) {
      if (Array.isArray(item) && validId(item[0]) && isModelImageStyle(item[1]) && item[1] !== "original")
        preferences.set(item[0], item[1]);
    }
  } catch { /* Display preferences must never prevent image loading. */ }
  return preferences;
}
export function getModelImageStyle(id: string): ModelImageStyle {
  return styles().get(id) ?? "original";
}
export function setModelImageStyle(id: string, style: ModelImageStyle) {
  if (!validId(id) || !isModelImageStyle(style)) return;
  const saved = styles();
  if ((saved.get(id) ?? "original") === style) return;
  saved.delete(id);
  if (style !== "original") saved.set(id, style);
  while (saved.size > MAX_STYLES) saved.delete(saved.keys().next().value!);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved])); }
  catch { /* Keep the current session usable when preference storage is full. */ }
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("rhine-model-image-style", { detail: { id, style } }));
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
// Radix Sand 3 / Sand 12 and Teal 12. Alpha is always copied from the source;
// transparent image margins and the original file are never painted over.
const paper = [241, 240, 239], ink = [33, 32, 28], teal = [13, 61, 56];
export function applyModelImageStyle(canvas: HTMLCanvasElement, style: ModelImageStyle) {
  if (style === "original") return;
  const context = canvas.getContext("2d")!;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data, width = canvas.width, height = canvas.height;
  const luminance = new Uint8Array(width * height);
  for (let index = 0; index < luminance.length; index++) {
    const offset = index * 4;
    luminance[index] = Math.round(data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722);
  }
  const cell = Math.max(4, Math.round(width / 512 * 7));
  const columns = Math.ceil(width / cell);
  const tones = style === "halftone" ? new Float32Array(columns * Math.ceil(height / cell)) : undefined;
  if (tones) {
    const weights = new Float32Array(tones.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x, alpha = data[index * 4 + 3] / 255;
      const slot = Math.floor(y / cell) * columns + Math.floor(x / cell);
      tones[slot] += luminance[index] * alpha;
      weights[slot] += alpha;
    }
    for (let index = 0; index < tones.length; index++) tones[index] = weights[index] ? tones[index] / weights[index] / 255 : 1;
  }
  const sample = (x: number, y: number, center: number) => {
    const index = Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x));
    return data[index * 4 + 3] ? luminance[index] : center;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, offset = index * 4;
    if (!data[offset + 3]) continue;
    const light = luminance[index] / 255;
    let amount = 1 - clamp((light - .04) / .92);
    if (tones) {
      const tone = tones[Math.floor(y / cell) * columns + Math.floor(x / cell)];
      const radius = Math.sqrt((1 - tone) / Math.PI) * cell;
      const distance = Math.hypot(x % cell - (cell - 1) / 2, y % cell - (cell - 1) / 2);
      amount = clamp(radius + .65 - distance);
    } else if (style === "linework") {
      const center = luminance[index];
      const gx = -sample(x - 1, y - 1, center) + sample(x + 1, y - 1, center) - 2 * sample(x - 1, y, center) + 2 * sample(x + 1, y, center) - sample(x - 1, y + 1, center) + sample(x + 1, y + 1, center);
      const gy = -sample(x - 1, y - 1, center) - 2 * sample(x, y - 1, center) - sample(x + 1, y - 1, center) + sample(x - 1, y + 1, center) + 2 * sample(x, y + 1, center) + sample(x + 1, y + 1, center);
      amount = clamp(((Math.abs(gx) + Math.abs(gy)) / 1020 - .04) * 1.8 + Math.max(0, .38 - light) * .16);
    }
    const dark = style === "duotone" ? teal : ink;
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(paper[channel] + (dark[channel] - paper[channel]) * amount);
  }
  context.putImageData(pixels, 0, 0);
}
