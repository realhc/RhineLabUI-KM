# 版本与发布包

GitHub 保留四个正式 Release。最新源码及本地程序为正式 1.2.1，也是默认下载版本。

| 当前版本 | 对应原版本 | 内容 | 交付 |
| --- | --- | --- | --- |
| [1.0.0](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.0.0) | 原 v1.2.0 | Windows 便携客户端、本地 Markdown、刻度目录、排版编辑与三维终端 | GitHub 正式 Release |
| [1.1.0](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.1.0) | 原 v1.3.0 | 搜索增强、可选 AI 助手、本机工具接口与定时文档 | GitHub 正式 Release |
| [1.2.0](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.2.0) | 正式 1.2.0 | 模型与正文图片、阅读导航、全局/局部图谱与反向引用、历史恢复、三类生成封面、磨砂夹层、图片艺术风格及外观调色盘/镀层/收藏色 | GitHub 正式 Release |
| [1.2.1](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.2.1) | 当前源码 | 设置分类整理、应用内名称、单篇模型颜色和六篇首启教程 | 最新正式 Release |

历史版本的归一只修正版本元数据和发行介绍，功能分别沿用原来的两个版本。相应历史源码提交仅纠正版本元数据；版本标签、程序版本、ZIP 文件名和校验清单保持一致。已有验收材料中的旧版本号及哈希是当时的记录。

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
    RhineLab-win32-x64/
      RhineLab.exe
      resources/
      RhineLabData/
```

历史版本只保留干净 ZIP 与 SHA-256 校验清单；当前 1.2.1 另保留可运行程序及用户原有知识库。ZIP 中不包含任何个人数据，升级或迁移时保留整个 `RhineLabData`。本机备注存放于 `local/notes/`，数据备份存放于 `local/data-backups/`，两者均不进入 Git。

`release/desktop/` 和 `release/packages/` 是构建时暂用的中间目录。正式归档完成后按用户授权清理，避免与三个保留版本混淆。
