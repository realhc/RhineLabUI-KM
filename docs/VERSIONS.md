# 版本与发布包

GitHub 保留两个正式 Release。最新源码及本地程序使用 1.2.0-preview.1，暂不发布 Release。

| 当前版本 | 对应原版本 | 内容 | 交付 |
| --- | --- | --- | --- |
| [1.0.0](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.0.0) | 原 v1.2.0 | Windows 便携客户端、本地 Markdown、刻度目录、排版编辑与三维终端 | GitHub 正式 Release |
| [1.1.0](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.1.0) | 原 v1.3.0 | 搜索增强、可选 AI 助手、本机工具接口与定时文档 | GitHub 正式 Release，默认下载版本 |
| 1.2.0-preview.1 | 当前 `main` | 图片、阅读定位、反向链接与局部图谱、历史恢复、统一档案标识与内容封面 | 最新源码与本地预览 |

历史版本的归一只修正版本元数据和发行介绍，功能分别沿用原来的两个版本。相应历史源码提交仅纠正版本元数据；版本标签、程序版本、ZIP 文件名和校验清单保持一致。已有验收材料中的旧版本号是当时的记录。

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
  local-1.2.0-preview.1/
    RhineLab-win32-x64-1.2.0-preview.1.zip
    SHA256SUMS.txt
    RhineLab-win32-x64/
      RhineLab.exe
      resources/
      RhineLabData/
```

历史版本只保留干净 ZIP 与 SHA-256 校验清单；最新预览另保留可运行程序及用户原有知识库。ZIP 中不包含任何个人数据，升级或迁移时保留整个 `RhineLabData`。本机备注存放于 `local/notes/`，数据备份存放于 `local/data-backups/`，两者均不进入 Git。

`release/desktop/` 和 `release/packages/` 是构建时暂用的中间目录。正式归档完成后按用户授权清理，避免与三个保留版本混淆。
