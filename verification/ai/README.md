# 1.3.0 搜索与可选 AI 验证

在不含个人数据的便携程序副本中运行。模型接口由本机确定性模拟服务提供，不使用真实 API Key，不向远程模型发送资料。

- `native-ui.json`：实际客户端的离线启动、搜索摘要/高亮、分类相关性、块级原文定位、编辑器重建、草稿保护、加密密钥、工具创建、总结、定时任务、语义补充和原生复制检查。
- `search.png`、`tasks.png`：实际客户端新能力的运行截图。
- `regression-motion.json`、`regression-recovery.json`：目录惯性、减少动态效果、窗口尺寸和图形恢复回归。
- `regression-rich-editor.json`、`regression-workflow.json`：排版工具、公式、表格、独立撤销、外部冲突与退出保护回归。
- `package-audit.json`：76 个 ZIP 文件逐项匹配便携目录、EXE 版本、运行资源与 ZIP SHA-256。
- `delivery.json`：本地程序与 ZIP 相对路径、版本、校验和及真实数据保留结果。该记录形成于功能交付时，早于 Release 发布；公开附件见 [v1.3.0 Release](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.3.0)。

行为测试位于 `scripts/check-desktop-search.mjs`、`check-desktop-ai.mjs`、`check-desktop-ai-automation.mjs` 和 `check-desktop-ai-ui.mjs`。源码维护规则见 `AGENT.md`，接入说明见 `docs/AI-API.md`。
