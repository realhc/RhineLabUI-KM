# Observatory / 观测室

atmosphere.ogg、motif.ogg、pulse.ogg 为原创程序编配的同步循环声部，无原片采样、外部录音或人声。源谱与合成脚本是 `scripts/render-audio.mjs`，生成参数在 `score.json`；原创配乐采用仓库 LICENSE（MIT）。交互音效由 `src/audio.ts` 合成。

## 开场逐字短音

`src/typing-samples.ts` 中嵌入的三个短音来自《明日方舟》特别映像《莱茵生命：访问》，时间约 6.864–6.986 秒，每个 38ms。开场会使用这些 PCM 片段；原音与衍生片段的权利归原作者，不纳入上述原创配乐的 MIT 声明。

`typing-source.json` 保存精确时间、源文件校验与处理参数；提取脚本是 `scripts/extract-typing-audio.mjs`。处理仅包括去直流、边缘淡变和统一增益，没有变调或变速。独立试听与对照文件生成在 Git 忽略的 `.tools/audio-render/`，不进入客户端分发资源。
