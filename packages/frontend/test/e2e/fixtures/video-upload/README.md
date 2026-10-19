<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

# 视频附件端到端测试样本

本目录的三个媒体样本供 [`video-upload-integrity.spec.ts`](../../video-upload-integrity.spec.ts) 使用。它们全部由 FFmpeg 的 `lavfi` 测试信号合成，不包含用户上传素材。

| 文件 | 轨道 | 用途 |
| --- | --- | --- |
| `video-audio.mp4` | 1 条视频轨、1 条音频轨 | 验证普通发帖、通用上传弹窗及取消后重试保留完整媒体，上传后能生成缩略图并显示播放画面。 |
| `video-silent.mp4` | 1 条视频轨、无音频轨 | 验证无声视频是有效输入，预处理后仍保留视频轨，能够预览和播放。 |
| `audio-only.mp4` | 无视频轨、1 条音频轨 | 验证后端按实际轨道将只有音频的 MP4 识别为音频附件，前端使用音频播放器展示。 |

## 重新生成

在本目录运行以下命令。FFmpeg 需要支持 `lavfi`、`libx264` 和 AAC 编码。

所有样本时长均为 2 秒。视频测试信号为 `testsrc2`，分辨率为 320 × 180，帧率为 15 帧/秒，编码为 H.264 Main，像素格式为 `yuv420p`。音频测试信号为 440 Hz 正弦波，采样率为 48,000 Hz，编码为 AAC，码率为 96 kb/s。三个 MP4 均启用 `faststart`。

### 视频与音频

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'testsrc2=size=320x180:rate=15' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
  -map 0:v:0 -map 1:a:0 -t 2 \
  -c:v libx264 -profile:v main -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart \
  video-audio.mp4
```

### 无声视频

只使用视频测试信号，并通过 `-an` 禁用音频输出。

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'testsrc2=size=320x180:rate=15' \
  -map 0:v:0 -t 2 -an \
  -c:v libx264 -profile:v main -pix_fmt yuv420p \
  -movflags +faststart \
  video-silent.mp4
```

### 只有音频的 MP4

只使用正弦波测试信号，并通过 `-vn` 禁用视频输出。保留 `.mp4` 扩展名，用于验证附件分类依据实际媒体轨道。

```sh
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
  -map 0:a:0 -t 2 -vn \
  -c:a aac -b:a 96k -movflags +faststart \
  audio-only.mp4
```

## 超限样本

大小限制场景所需的 `video-over-limit.mp4` 由 `video-upload-integrity.spec.ts` 在运行时使用 FFmpeg 生成，并写入 Playwright 的本次测试输出目录。测试会先确认文件超过策略限制，再检查原片回退后的上传和发帖行为。该大文件不放入本目录，也不提交到仓库。
