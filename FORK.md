# Fork 说明

本仓库是 [nicobailon/pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) 的 fork，
在原扩展基础上加入了自定义状态发布器。本文记录来源、本地改动和上游更新合并流程。

## 上游来源

| 上游 | 作用 | 集成方式 |
|------|------|----------|
| [nicobailon/pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) | powerline 状态栏主体(编辑器边框渲染、git/queue/bash-mode 等) | 本仓库主体,git fork 关系保留 |
| [YuGiMob/pi-tps-status](https://github.com/YuGiMob/pi-tps-status) | `⚡ TPS` 实时速率/TTFT 小部件 | **不在本仓库内**,单独以 `npm:pi-tps-status` 安装;其 `sourceLabel()` 控制 `[provider]` 来源标签 |

fork 基点:上游 `1e95b91`(v0.17.0)。

## 本仓库相对上游的改动

- `custom-status.ts`(新增)— 三个状态发布器:
  - `context-bar`:上下文进度条(14 格 + 占用量/窗口总量 + 百分比)
  - `req-stats`:单次请求 token(↑发送/↓接收)与延迟(首字/单次/整轮),保留旧值 + 更新闪烁
  - `model-think`:模型名+思考等级合并显示(如 `glm-5.3-flash:max`)
  通过 `ctx.ui.setStatus()` 输出,由 `settings.json` 的 `powerline.customItems` 挂载
  (statusKey:`context-bar` / `req-stats` / `model-think`)。
- `index.ts`(2 行接线)— 顶部 import + 默认导出开头调用 `registerCustomStatus(pi)`。

## 如何合并上游更新

```bash
git remote add upstream https://github.com/nicobailon/pi-powerline-footer.git  # 首次
git fetch upstream
git merge upstream/main          # 或 rebase
```

- 改动都在 `custom-status.ts`(上游不存在的文件)+ `index.ts` 仅 2 行接线,
  合并冲突大概率只出现在 `index.ts`,重接一次即可。
- 上游若改了 `SegmentContext`/`setStatus` 契约,需检查 `custom-status.ts` 对
  `ctx.getContextUsage()` / `ctx.model` / `ctx.thinkingLevel` / `ctx.ui.theme` 的使用。
- 若上游吸收了 pi-tps-status 或发布到 npm,可评估直接切回上游。

## 本地同步方式

`settings.json` 中以 git 包形式安装:

```json
"packages": ["git:github.com/YsLtr/pi-powerline-footer"]
```

改完本仓库 push 后,重新 `pi install git:github.com/YsLtr/pi-powerline-footer` + `/reload` 生效。
