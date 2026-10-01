import { setDesktopDocuments } from "./desktop-data";
import "./desktop-shell.css";
async function startDesktop() {
  try {
    const result = await window.rhine.list();
    setDesktopDocuments(result.documents,result.categories,result.nextLane);
    await import("./desktop-main");
  } catch (error) {
    const message = document.createElement("p");
    message.textContent = "知识库载入失败：" + String(error);
    const retry = document.createElement('button');
    retry.textContent = '重新连接';
    retry.onclick = () => location.reload();
    document.body.replaceChildren(message, retry);
  }
}
void startDesktop();
