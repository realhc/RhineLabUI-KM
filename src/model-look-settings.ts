import { normalizeModelLook, type ModelLookPreferences } from "./model-look.ts";
import "./model-look-settings.css";

const modes = [["original", "原色"], ["solid", "统一颜色"], ["palette", "多彩"]] as const;
const coatings = [["natural", "原始"], ["satin", "缎面"], ["metal", "金属"], ["pearl", "珠光"]] as const;
const percent = (value: number) => Math.round(value * 100);
const paletteMarkup = (colors: string[]) => colors.map((color, index) =>
  `<label class="model-look-swatch" style="--model-look-swatch:${color}"><input type="color" data-model-look-palette="${index}" value="${color}" aria-label="调色盘颜色 ${index + 1}"/><span class="model-look-swatch-index">${index + 1}</span></label>`).join("");

export function modelLookMarkup(config: ModelLookPreferences) {
  const look = normalizeModelLook(config);
  return `<section class="model-look-settings" aria-label="模型外观设置">
    <div class="model-look-heading"><h3>APPEARANCE <span>外观</span></h3><button type="button" data-model-look-action="reset">恢复默认</button></div>
    <div class="model-look-row"><span>模型配色</span><div class="model-look-choices" role="group" aria-label="模型配色模式">${modes.map(([value, label]) => `<button type="button" data-model-look-mode="${value}" aria-pressed="${look.mode === value}">${label}</button>`).join("")}</div></div>
    <label class="model-look-row"><span>统一颜色</span><span class="model-look-color-value"><input type="color" data-model-look-color="color" value="${look.color}" aria-label="统一模型颜色"/><output data-model-look-output="color">${look.color}</output></span></label>
    <div class="model-look-row"><span>多彩调色盘</span><div class="model-look-palette" data-model-look-palette-container role="group" aria-label="多彩调色盘">${paletteMarkup(look.palette)}</div></div>
    <div class="model-look-row"><span>镀层</span><div class="model-look-choices" role="group" aria-label="模型镀层">${coatings.map(([value, label]) => `<button type="button" data-model-look-coating="${value}" aria-pressed="${look.coating === value}">${label}</button>`).join("")}</div></div>
    <label class="model-look-row"><span>颜色强度</span><span class="model-look-range"><input type="range" data-model-look-strength aria-label="模型颜色强度" min="0" max="100" step="1" value="${percent(look.strength)}"/><output data-model-look-output="strength">${percent(look.strength)}%</output></span></label>
    <div class="model-look-row"><label class="model-look-favorites"><input type="checkbox" data-model-look-favorites ${look.favoriteEnabled ? "checked" : ""}/><span>收藏专属颜色</span></label><span class="model-look-color-value"><input type="color" data-model-look-color="favoriteColor" value="${look.favoriteColor}" aria-label="收藏模型颜色"/><output data-model-look-output="favoriteColor">${look.favoriteColor}</output></span></div>
  </section>`;
}

/** Keep live controls and the native color picker mounted while values change. */
export function syncModelLookUI(root: ParentNode, config: ModelLookPreferences) {
  const section = root instanceof Element && root.matches(".model-look-settings") ? root : root.querySelector(".model-look-settings");
  if (!section) return;
  const look = normalizeModelLook(config);
  for (const [selector, key] of [["[data-model-look-mode]", "mode"], ["[data-model-look-coating]", "coating"]] as const)
    section.querySelectorAll<HTMLButtonElement>(selector).forEach(button => button.setAttribute("aria-pressed", String(button.dataset[key === "mode" ? "modelLookMode" : "modelLookCoating"] === look[key])));
  section.querySelectorAll<HTMLInputElement>("[data-model-look-color]").forEach(input => {
    const key = input.dataset.modelLookColor === "favoriteColor" ? "favoriteColor" : "color";
    if (input.value !== look[key]) input.value = look[key];
  });
  const palette = section.querySelector<HTMLElement>("[data-model-look-palette-container]");
  if (palette && palette.querySelectorAll("[data-model-look-palette]").length !== look.palette.length) palette.innerHTML = paletteMarkup(look.palette);
  palette?.querySelectorAll<HTMLInputElement>("[data-model-look-palette]").forEach((input, index) => {
    if (input.value !== look.palette[index]) input.value = look.palette[index];
    input.closest<HTMLElement>(".model-look-swatch")?.style.setProperty("--model-look-swatch", look.palette[index]);
  });
  const strength = section.querySelector<HTMLInputElement>("[data-model-look-strength]");
  if (strength && strength.value !== String(percent(look.strength))) strength.value = String(percent(look.strength));
  const favorite = section.querySelector<HTMLInputElement>("[data-model-look-favorites]");
  if (favorite) favorite.checked = look.favoriteEnabled;
  section.querySelectorAll<HTMLOutputElement>("[data-model-look-output]").forEach(output => {
    const key = output.dataset.modelLookOutput;
    output.value = key === "strength" ? `${percent(look.strength)}%` : key === "favoriteColor" ? look.favoriteColor : look.color;
  });
}
