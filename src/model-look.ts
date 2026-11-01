import { archiveSeed } from "./archive-identity.ts";

export type ModelLookMode = "original" | "solid" | "palette";
export type ModelLookCoating = "natural" | "satin" | "metal" | "pearl";
export type ModelLookPreferences = {
  mode: ModelLookMode;
  color: string;
  palette: string[];
  strength: number;
  coating: ModelLookCoating;
  favoriteEnabled: boolean;
  favoriteColor: string;
};
export type ModelLookDocument = { id: string; category?: string; placeholder?: boolean };

// Radix Teal, Blue, Iris, Plum and Bronze. Amber remains the default saved-file cue.
const palette = ["#12a594", "#0090ff", "#5b5bd6", "#ab4aba", "#a18072"];
const modes: readonly string[] = ["original", "solid", "palette"];
const coatings: readonly string[] = ["natural", "satin", "metal", "pearl"];
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function defaultModelLook(): ModelLookPreferences {
  return { mode: "original", color: "#12a594", palette: [...palette], strength: .65,
    coating: "natural", favoriteEnabled: false, favoriteColor: "#ffc53d" };
}

/** Only opaque hexadecimal colors can reach a shader or an inline swatch style. */
export function normalizeModelLookColor(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) return "#" + [...hex.slice(1)].map(value => value + value).join("");
}

/** Corrupt/old local preferences fall back per field; returned arrays are owned. */
export function normalizeModelLook(input?: unknown): ModelLookPreferences {
  const result = defaultModelLook();
  if (!object(input)) return result;
  if (typeof input.mode === "string" && modes.includes(input.mode)) result.mode = input.mode as ModelLookMode;
  result.color = normalizeModelLookColor(input.color) ?? result.color;
  if (Array.isArray(input.palette) && input.palette.length >= 3 && input.palette.length <= 8) {
    const colors = input.palette.map(normalizeModelLookColor);
    if (colors.every((color): color is string => !!color)) result.palette = colors;
  }
  if (typeof input.strength === "number" && Number.isFinite(input.strength))
    result.strength = Math.max(0, Math.min(1, input.strength));
  if (typeof input.coating === "string" && coatings.includes(input.coating)) result.coating = input.coating as ModelLookCoating;
  if (typeof input.favoriteEnabled === "boolean") result.favoriteEnabled = input.favoriteEnabled;
  result.favoriteColor = normalizeModelLookColor(input.favoriteColor) ?? result.favoriteColor;
  return result;
}

/** Imports reject malformed recognized fields, while allowing older partial files. */
export function parseModelLook(input: unknown): ModelLookPreferences {
  if (!object(input)) throw new Error("模型外观设置格式无效。");
  if ("mode" in input && (typeof input.mode !== "string" || !modes.includes(input.mode)))
    throw new Error("模型配色模式无效。");
  if ("coating" in input && (typeof input.coating !== "string" || !coatings.includes(input.coating)))
    throw new Error("模型镀层设置无效。");
  for (const key of ["color", "favoriteColor"] as const)
    if (key in input && !normalizeModelLookColor(input[key])) throw new Error("模型颜色必须为十六进制色值。");
  if ("palette" in input && (!Array.isArray(input.palette) || input.palette.length < 3 || input.palette.length > 8 ||
      !input.palette.every(value => !!normalizeModelLookColor(value))))
    throw new Error("模型调色盘须包含 3 到 8 个有效颜色。");
  if ("strength" in input && (typeof input.strength !== "number" || !Number.isFinite(input.strength) || input.strength < 0 || input.strength > 1))
    throw new Error("模型颜色强度须在 0 到 1 之间。");
  if ("favoriteEnabled" in input && typeof input.favoriteEnabled !== "boolean")
    throw new Error("收藏专属颜色设置必须为布尔值。");
  return normalizeModelLook(input);
}

export function modelLookKey(config: ModelLookPreferences): string {
  const value = normalizeModelLook(config);
  return JSON.stringify([value.mode, value.color, value.palette, value.strength, value.coating, value.favoriteEnabled, value.favoriteColor]);
}

/** Stable identity only; model position, array slot and document order play no role. */
export function modelLookColor(config: ModelLookPreferences, doc: ModelLookDocument, isSaved = false): string | null {
  if (!doc || doc.placeholder || typeof doc.id !== "string" || !doc.id) return null;
  if (config.favoriteEnabled && isSaved) return config.favoriteColor;
  if (config.mode === "solid") return config.color;
  if (config.mode !== "palette") return null;
  const category = doc.category?.trim().normalize("NFC") || "未分类";
  return config.palette[archiveSeed(category + "\0" + doc.id.normalize("NFC")) % config.palette.length];
}
