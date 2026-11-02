import { parseUserName, readLocalSettings, saveLocalUserName, userNameFromSettings } from "./local-user";
import "./local-user.css";

/** Resolve only after a stored identity exists; do not load the terminal first. */
export async function ensureLocalUser(): Promise<string> {
  try {
    const saved = userNameFromSettings(readLocalSettings());
    if (saved) return saved;
  } catch { /* The gate below offers a local read retry. */ }
  return new Promise(resolve => {
    const root = document.createElement("section");
    root.id = "local-user-gate";
    root.setAttribute("aria-labelledby", "local-user-heading");
    root.innerHTML = '<form id="local-user-form" novalidate><h1 id="local-user-heading">欢迎使用</h1><label for="local-username">用户名</label><input id="local-username" name="username" type="text" maxlength="32" autocomplete="username" required aria-describedby="local-user-status"/><p id="local-user-status" role="status" aria-live="polite"></p><button id="local-user-submit" type="submit">进入知识库</button><button id="local-user-retry" type="button" hidden>重试读取</button></form>';
    const viewport = document.querySelector<HTMLElement>("#viewport");
    const previousInert = viewport?.inert;
    if (viewport) viewport.inert = true;
    document.body.append(root);
    const form = root.querySelector<HTMLFormElement>("form")!;
    const input = root.querySelector<HTMLInputElement>("#local-username")!;
    const submit = root.querySelector<HTMLButtonElement>("#local-user-submit")!;
    const retry = root.querySelector<HTMLButtonElement>("#local-user-retry")!;
    const status = root.querySelector<HTMLElement>("#local-user-status")!;
    const finish = (username: string) => {
      root.remove();
      if (viewport) viewport.inert = previousInert ?? false;
      resolve(username);
    };
    const check = () => {
      try {
        const saved = userNameFromSettings(readLocalSettings());
        if (saved) { finish(saved); return; }
        input.disabled = submit.disabled = false;
        retry.hidden = true;
        status.textContent = "";
        input.focus();
      } catch {
        input.disabled = submit.disabled = true;
        retry.hidden = false;
        status.textContent = "无法读取本机设置，请重试。";
        retry.focus();
      }
    };
    retry.onclick = check;
    form.onsubmit = event => {
      event.preventDefault();
      if (submit.disabled) return;
      let username: string;
      try { username = parseUserName(input.value); }
      catch (error) {
        status.textContent = error instanceof Error ? error.message : "请输入有效用户名。";
        input.setAttribute("aria-invalid", "true"); input.focus(); return;
      }
      try { finish(saveLocalUserName(username)); }
      catch {
        status.textContent = "用户名无法保存，请重试。";
        input.setAttribute("aria-invalid", "true"); input.focus();
      }
    };
    input.oninput = () => { input.removeAttribute("aria-invalid"); status.textContent = ""; };
    check();
  });
}
