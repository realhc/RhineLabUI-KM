# 源码与开发

当前 `main` 对应 1.2.0-preview.1，包含最新关系图谱功能。正式版本与本地归档见 [VERSIONS.md](VERSIONS.md)；使用说明见 [README.md](../README.md)，维护边界见 [AGENT.md](../AGENT.md)。

## 目录地图

| 路径 | 职责 |
| --- | --- |
| `desktop/` | Electron 窗口、受限 IPC、Markdown 仓库、分类、AI 服务与本机接口 |
| `src/` | Three.js 阵列、知识库界面、富文本编辑器、图片和关系图谱 |
| `public/` | 运行资源、字体及第三方许可 |
| `content/` | 初始档案和编辑演示 |
| `art/` | 模型制作脚本与 Blender 源工程 |
| `scripts/` | 开发入口、构建、资源生成、打包和校验工具 |
| `tests/` | 纯逻辑、文件仓库、打包及实际客户端检查；`fixtures/` 保存测试基准 |
| `docs/` | 使用、开发、版本和资源说明；`media/` 保存 README 截图 |
| `verification/` | 保留的验收记录和截图 |

`release/` 是本地发行归档与构建输出，`local/` 是本机备注和数据备份，`RhineLabData/` 是开发知识库；这些目录均不进入 Git。`desktop/search.mjs` 和 `desktop/icon.ico` 由构建工具生成。

阅读导航与文档大纲位于 `src/desktop-reading.ts`；文档关系在 `src/desktop-relations.ts`，历史浏览在 `src/desktop-history.ts`。档案身份由 `src/archive-identity.ts` 统一，程序生成封面的排版与几何规则保存在 `src/archive-cover.ts`。这些模块不把视觉装饰写入 Markdown。

## 开发与构建

需要 Node.js 22.12 或更新版本。Windows 使用 `npm.cmd`，在仓库根目录执行：

```powershell
npm.cmd ci
npm.cmd run dev:desktop
```

生成当前源码的便携客户端：

```powershell
npm.cmd run package:desktop
npm.cmd run check:desktop:package
```

构建资源在 `release/desktop/`，Forge 程序和 ZIP 在 `release/packages/`。这些是可再生的中间输出，完成验收后将干净程序、ZIP 与校验清单归档到 [版本说明](VERSIONS.md) 约定的目录，再按授权清理中间输出。当前预览版只作本地交付，源码更新不触发 Release。

## 检查与资料

按修改范围选择 [tests/README.md](../tests/README.md) 中的检查。编辑、数据或启动修改须检查实际打包客户端；GUI 检查顺序执行，并复制程序到隔离目录。测试副本必须排除真实 `RhineLabData`，使用虚构文档和独立配置。

[plan.md](../plan.md) 记录当前维护范围，[DESIGN.md](../DESIGN.md) 记录既有视觉和交互基准，[HANDOFF.md](../HANDOFF.md) 记录实现陷阱。历史验收材料保留当时的版本号和脚本路径；当前命令以 `package.json` 和 `tests/README.md` 为准。
