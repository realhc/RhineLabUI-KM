import { fullMotion } from "./motion-preferences.ts";
import { normalizeQuality } from "./render-quality.ts";
import { parseModelLook } from "./model-look.ts";

export const PREFERENCES_MAX_BYTES = 1024 * 1024;
export type PreferencesTransfer = {
  version: 1;
  settings: Record<string, unknown>;
  saved: string[];
};

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Import only recognized preferences; never merge arbitrary JSON into live state. */
export function parsePreferencesTransfer(text: string): PreferencesTransfer {
  if (new TextEncoder().encode(text).length > PREFERENCES_MAX_BYTES)
    throw new Error("设置文件不能超过 1 MB。");
  const value: unknown = JSON.parse(text);
  if (
    !object(value) ||
    value.version !== 1 ||
    !object(value.settings) ||
    !Array.isArray(value.saved)
  ) {
    throw new Error("请选择版本 1 的莱茵设置与收藏 JSON 文件。");
  }
  if (
    value.saved.length > 10000 ||
    !value.saved.every(
      (id) =>
        typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id),
    )
  ) {
    throw new Error("收藏列表包含无效文档编号。");
  }
  const source = value.settings;
  const settings: Record<string, unknown> = {};
  for (const key of [
    "sound",
    "music",
    "reduced",
    "quality",
    "superPerformance",
  ]) {
    if (key in source) {
      if (typeof source[key] !== "boolean")
        throw new Error(`设置 ${key} 必须为布尔值。`);
      settings[key] = source[key];
    }
  }
  for (const key of ["soundVolume", "musicVolume"]) {
    if (key in source) {
      const number = source[key];
      if (
        typeof number !== "number" ||
        !Number.isFinite(number) ||
        number < 0 ||
        number > 1
      )
        throw new Error(`设置 ${key} 必须在 0 到 1 之间。`);
      settings[key] = number;
    }
  }
  if ("colorTheme" in source) {
    if (!["light", "dark"].includes(String(source.colorTheme)))
      throw new Error("主题设置无效。");
    settings.colorTheme = source.colorTheme;
  }
  if ("motionPreset" in source) {
    if (!["full", "reduced", "custom"].includes(String(source.motionPreset)))
      throw new Error("动效预设无效。");
    settings.motionPreset = source.motionPreset;
  }
  if ("motion" in source) {
    if (!object(source.motion)) throw new Error("动效设置格式无效。");
    const motion: Record<string, unknown> = {};
    for (const key of Object.keys(fullMotion())) {
      if (key in source.motion) {
        if (typeof source.motion[key] !== "boolean")
          throw new Error(`动效设置 ${key} 必须为布尔值。`);
        motion[key] = source.motion[key];
      }
    }
    if ("preset" in source.motion) {
      if (!["full", "reduced", "custom"].includes(String(source.motion.preset)))
        throw new Error("动效预设无效。");
      motion.preset = source.motion.preset;
    }
    settings.motion = motion;
  }
  if ("rendering" in source) {
    if (!object(source.rendering)) throw new Error("画质设置格式无效。");
    const normalized = normalizeQuality(source.rendering);
    for (const key of Object.keys(normalized) as (keyof typeof normalized)[]) {
      if (key in source.rendering && source.rendering[key] !== normalized[key])
        throw new Error(`画质设置 ${key} 超出支持范围。`);
    }
    settings.rendering = normalized;
  }
  if ("modelLook" in source) settings.modelLook = parseModelLook(source.modelLook);
  return { version: 1, settings, saved: [...new Set(value.saved as string[])] };
}
