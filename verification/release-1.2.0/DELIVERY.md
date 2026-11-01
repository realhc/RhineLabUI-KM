# 正式 1.2.0 发布验收

2026-11-01。Windows x64 便携正式版。

## 版本与交付

源码 package.json、锁文件根版本、ASAR package.json、Windows FileVersion 与 ProductVersion 均为 1.2.0。EXE 中 ELECTRONASAR 完整性条目已更新为新 ASAR 头部的 SHA-256。

- 发布：[GitHub v1.2.0](https://github.com/realhc/RhineLabUI-KM/releases/tag/v1.2.0)
- 程序：`release/v1.2.0/RhineLab-win32-x64/RhineLab.exe`
- 附件：`RhineLab-win32-x64-1.2.0.zip`（191,695,793 字节）和 `SHA256SUMS.txt`
- ZIP SHA-256：`331c463c65a940732766032271df796413ffee77eb5913ac70594d3e5807f81b`
- ASAR SHA-256：`a8f387aba09e9d143f5b9b0dbed71c7539ee8d96927ed7c46093a97b70957abb`

## 核验

- 本轮仅更新正式版本元数据，编译资产复用已验收的同一份程序。此前全项目类型检查、Vite 生产构建、八个相关专项及原路径外观回归通过，详见 [外观设置记录](../model-look-settings/DELIVERY.md)。
- ASAR 863 项资源逐一读回哈希匹配。除 package.json 版本外，所有打包文件与此前已验收的文件一致。
- ZIP 76 项与最终运行目录逐文件 SHA-256 匹配；7-Zip 检查 Everything is Ok。附件无 RhineLabData、开发依赖、私有字体源或调试日志。
- 正式目录原生启动成功，app.getVersion() 为 1.2.0。设置外观区的 3 种配色、5 个调色盘色卡与 4 种镀层均存在。页面、shader 和帧错误为 0。
- sandbox/contextIsolation 为 true，nodeIntegration 为 false，未放宽 Electron 安全选项。
- 原始本机偏好不变，退出产生的窗口偏好已还原原始字节；88 个原知识库文件逐项哈希不变。
- 发布前源码、JSON 和截图隐私审查通过。截图均使用虚构档案；含真实库截图的 local/notes 继续忽略，不进入 Git 或附件。

原生验证无截图，不输出个人文档标题或路径。[打包结果](package-result.json)、[ZIP 结果](zip-result.json)、[最终启动结果](native-result.json) 仅含版本、统计、哈希和安全状态。

## 清理

一次性 ASAR、发布验收助手、偏好/窗口备份与运行调试日志按明确路径逐项清理，约释放 36.3 MiB。正式包、源码、依赖、历史归档与验收材料保留。
