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
- `index.ts`(响应式布局)— 溢出装箱新增**第三行**:次行装不下的段继续在第三行按宽度装箱,
  首个三行都放不下的段之后的所有段一并丢弃。上游自 v0.2.24 起为「次行装满即止、多出的段整段丢弃」,
  故第三行属本地改动。段序在行间保持:一旦有段落入第三行,次行即封盘,后续段不再回填次行
  —— 否则后面的窄段会被放回次行、显示在溢出段之前(实测 4000 组随机宽度中有 137 组出现该乱序)。
  封盘的代价是同种情形下末段可能不显示(实测同上,77 组各少显示 1–2 段,无一组多显示),以段序换显示量。
  改动点:`computeResponsiveLayout` 返回类型与装箱循环、`getResponsiveLayout`/`lastLayoutResult`
  的类型与复位、`renderPowerlineSecondaryLines` 返回「次行 + 第三行」;该函数改为 `export` 以便测试。
  测试:`tests/responsive-layout.test.ts`。上游的 `README.md` / `CHANGELOG.md` 仍写两行语义,
  本 fork 未改这两份文件(合并时无冲突,但与本 fork 的实际行为不一致)。

## 如何合并上游更新

```bash
git remote add upstream https://github.com/nicobailon/pi-powerline-footer.git  # 首次
git fetch upstream
git merge upstream/main          # 或 rebase
```

- 改动都在 `custom-status.ts`(上游不存在的文件)+ `index.ts` 的接线与布局函数两处,
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
