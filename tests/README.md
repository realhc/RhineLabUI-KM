# 检查入口

在仓库根目录运行命令。`tests/` 保存检查脚本，`fixtures/` 保存对照基准；构建工具仍在 `scripts/`。Windows 使用 `npm.cmd`，需要 Node.js 22.12 或更新版本。

## 默认检查

```powershell
npm.cmd test
```

默认检查覆盖初始内容、文件仓库、分类、展陈、图片、文档链接解析及打包资源。按本次修改范围选择额外检查，脚本别名见根目录 `package.json`。

| 修改范围 | 检查 |
| --- | --- |
| 搜索与高亮 | `npm.cmd run check:desktop:search` |
| 文档链接解析 | `npm.cmd run check:desktop:graph-data` |
| AI 服务与持久任务 | `npm.cmd run check:desktop:ai` |
| 阵列拖动与动效 | `node --experimental-strip-types tests/check-archive-drag.mjs`、`node --experimental-strip-types tests/check-motion.mjs` |
| 模型与解密 | `node --experimental-strip-types tests/check-assembly.mjs`、`node --experimental-strip-types tests/check-decryption.mjs` |

## 实际客户端检查

先构建打包程序，再顺序执行与修改有关的 GUI 检查：

```powershell
npm.cmd run package:desktop
npm.cmd run check:desktop:package
npm.cmd run check:desktop:editor
npm.cmd run check:desktop:graph-ui
npm.cmd run check:desktop:drafting-ui
```

图片检查使用 `check:desktop:model-images-ui` 和 `check:desktop:document-images-ui`；AI 界面使用 `check:desktop:ai-ui`。启动和界面生命周期使用 `check:desktop:recovery`、`check:desktop:motion`，分类及文件工作流使用 `check:desktop:category-ui`、`check:desktop:workflow`。

GUI 检查默认从 `release/packages/RhineLab-win32-x64/` 复制程序到隔离目录，并使用独立配置和虚构文档。不要把保留用户数据的本地预览目录当作测试数据源；复制必须排除真实 `RhineLabData`。验收结果和截图保存在 `verification/`，生成目录的清理遵守当前用户授权。历史验收记录中的 `scripts/check-*` 是移动前的路径，当前脚本位于 `tests/`。
