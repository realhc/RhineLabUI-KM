# 版本与发布包

GitHub 保留 1.0.0、1.1.0、1.2.3 三个正式 Release。最新源码及本地程序为正式 1.2.3，也是默认下载版本。1.2.0、1.2.1、1.2.2 的 Release 已移除，源码标签和本地历史 ZIP 保留。

| 版本 | 对应原版本 | 内容 | 交付 |
| --- | --- | --- | --- |
| [1.0.0](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.0.0) | 原 v1.2.0 | Windows 便携客户端、本地 Markdown、刻度目录、排版编辑与三维终端 | GitHub 正式 Release |
| [1.1.0](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.1.0) | 原 v1.3.0 | 搜索增强、可选 AI 助手、本机工具接口与定时文档 | GitHub 正式 Release |
| 1.2.0 | 历史版本 | 模型与正文图片、阅读导航、图谱、历史恢复、生成封面及模型外观 | Release 已移除，保留标签与本地 ZIP |
| 1.2.1 | 历史版本 | 设置分类、应用内名称、单篇模型颜色和六篇首启教程 | Release 已移除，保留标签与本地 ZIP |
| 1.2.2 | 历史版本 | 简介标题遮蔽修复、设置选项始终展开、开场名称字形优化 | Release 已移除，保留标签与本地 ZIP |
| [1.2.3](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.2.3) | 当前源码 | 首次填写本地用户名、身份显示与日志同步、README 和维护交接整理 | 最新正式 Release，默认下载版本 |

历史版本归一只修正版本元数据与发行介绍。历史源码标签、已有验收中的旧版本号和哈希保留当时记录；移除 Release 不改写源码历史。

## 本地目录

以下路径均相对于仓库根目录，整个 `release/` 不进入 Git。

```text
release/
  v1.0.0/  # 历史 ZIP 与 SHA256SUMS.txt
  v1.1.0/  # 历史 ZIP 与 SHA256SUMS.txt
  v1.2.0/  # 历史 ZIP 与 SHA256SUMS.txt
  v1.2.1/  # 历史 ZIP 与 SHA256SUMS.txt
  v1.2.2/  # 历史 ZIP 与 SHA256SUMS.txt
  v1.2.3/
    RhineLab-win32-x64-1.2.3.zip
    SHA256SUMS.txt
    RhineLab-win32-x64/
      RhineLab.exe
      resources/
      RhineLabData/
```

当前 1.2.3 保留可运行程序和用户原有知识库，历史版本保留干净 ZIP 与校验清单。发布包不预置用户名，不携带个人设置或知识库。用户名与其他偏好存于本机，可通过设置导出文件迁移；文档、图片和历史则随整个 `RhineLabData` 备份与迁移。

本地知识库继续保留 50 篇 AI 文档与 6 篇教程。发行包只在全新空知识库首次启动时导入六篇教程；已经初始化的库删空后不会反复导入。

本机备注位于 `local/notes/`，数据备份位于 `local/data-backups/`，两者均不进入 Git。`release/desktop/` 和 `release/packages/` 是构建中间目录，完成归档后按用户授权清理。
