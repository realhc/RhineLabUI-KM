# 版本与发布包

GitHub 保留 1.0.0、1.1.0、1.2.2 三个正式 Release。最新源码及本地程序为正式 1.2.2，也是默认下载版本。1.2.0、1.2.1 的 Release 已移除，源码标签和本地历史 ZIP 保留。

| 版本 | 对应原版本 | 内容 | 交付 |
| --- | --- | --- | --- |
| [1.0.0](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.0.0) | 原 v1.2.0 | Windows 便携客户端、本地 Markdown、刻度目录、排版编辑与三维终端 | GitHub 正式 Release |
| [1.1.0](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.1.0) | 原 v1.3.0 | 搜索增强、可选 AI 助手、本机工具接口与定时文档 | GitHub 正式 Release |
| 1.2.0 | 历史版本 | 模型与正文图片、阅读导航、全局/局部图谱、反向引用、历史恢复、生成封面、磨砂夹层及模型外观 | Release 已移除，保留源码标签与本地 ZIP |
| 1.2.1 | 历史版本 | 设置分类整理、应用内名称、单篇模型颜色和六篇首启教程 | Release 已移除，保留源码标签与本地 ZIP |
| [1.2.2](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.2.2) | 当前源码 | 简介标题遮蔽动画修复、动态与画质选项始终展开、开场名称字形优化 | 最新正式 Release，默认下载版本 |

历史版本的归一只修正版本元数据和发行介绍，功能分别沿用原来的两个版本。历史源码标签、已有验收中的旧版本号及哈希保留当时记录；移除 Release 不改写源码历史。

## 本地目录

以下路径均相对于仓库根目录，整个 `release/` 不进入 Git。

```text
release/
  v1.0.0/
    RhineLab-win32-x64-1.0.0.zip
    SHA256SUMS.txt
  v1.1.0/
    RhineLab-win32-x64-1.1.0.zip
    SHA256SUMS.txt
  v1.2.0/
    RhineLab-win32-x64-1.2.0.zip
    SHA256SUMS.txt
  v1.2.1/
    RhineLab-win32-x64-1.2.1.zip
    SHA256SUMS.txt
  v1.2.2/
    RhineLab-win32-x64-1.2.2.zip
    SHA256SUMS.txt
    RhineLab-win32-x64/
      RhineLab.exe
      resources/
      RhineLabData/
```

历史版本只保留干净 ZIP 与 SHA-256 校验清单；当前 1.2.2 另保留可运行程序及用户原有知识库。ZIP 不包含个人数据，升级或迁移时保留整个 `RhineLabData`。本机备注位于 `local/notes/`，数据备份位于 `local/data-backups/`，两者均不进入 Git。

本地知识库继续保留 50 篇 AI 文档与 6 篇使用教程；发行包只在全新空知识库首次启动时提供 6 篇教程，不携带个人文档。已初始化的库删空后不会反复导入。

`release/desktop/` 和 `release/packages/` 是构建时暂用的中间目录，正式归档完成后按用户授权清理。
