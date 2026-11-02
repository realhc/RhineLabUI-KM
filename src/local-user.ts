export const USERNAME_MAX_LENGTH = 32;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Display-only local identity. An absent value always remains absent. */
export function normalizeUserName(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim().normalize("NFC") : "";
}
export function parseUserName(value: unknown): string {
  const username = normalizeUserName(value);
  if (!username) throw new Error("请输入用户名。");
  if (Array.from(username).length > USERNAME_MAX_LENGTH) throw new Error("用户名不能超过 32 个字符。");
  return username;
}
export function readLocalSettings(): Record<string, unknown> {
  const raw = localStorage.getItem("rhine-settings");
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (!object(value)) throw new Error("本机设置格式无效。");
  return value;
}
export function userNameFromSettings(settings: Record<string, unknown>): string {
  try { return parseUserName(settings.username); } catch { return ""; }
}
export function localUserName(): string {
  try { return userNameFromSettings(readLocalSettings()); } catch { return ""; }
}
export function saveLocalUserName(value: unknown): string {
  const username = parseUserName(value);
  const settings = readLocalSettings();
  localStorage.setItem("rhine-settings", JSON.stringify({ ...settings, username }));
  if (userNameFromSettings(readLocalSettings()) !== username) throw new Error("用户名未能保存。");
  return username;
}
