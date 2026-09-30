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
    document.body.replaceChildren(message);
  }
}
void startDesktop();
