export const DEFAULT_APP_NAME = "RHINE LAB";
export function normalizeAppName(value: unknown): string {
  return typeof value === "string" ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g," ").trim()).slice(0,48).join("") || DEFAULT_APP_NAME : DEFAULT_APP_NAME;
}
export function appName(): string {
  try { return normalizeAppName(JSON.parse(localStorage.getItem("rhine-settings") || "{}").displayName); } catch { return DEFAULT_APP_NAME; }
}
export function appNameHtml(): string { return appName().replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!); }

if (typeof document !== "undefined") document.documentElement.dataset.customAppName = String(appName() !== DEFAULT_APP_NAME);
