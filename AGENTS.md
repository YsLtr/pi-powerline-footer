# pi-powerline-footer(fork)

pi 的状态行插件。本仓库是 `nicobailon/pi-powerline-footer` 的 fork,在既有段之上加入了三个自定义状态发布器。
上游来源、本 fork 相对上游的全部改动、合并上游的步骤见 [`FORK.md`](FORK.md)。

## 交接

> 本节在下一次交接时整体替换。

### 本轮完成的工作

起因是 pi-deep-plan 的状态栏条目从状态行上消失,且其它扩展的状态一起消失。定位到本仓库的响应式装箱:溢出段只装一行,行满即止,其后的段整段丢弃。本轮把溢出扩展为第三行,并修掉由此暴露的段序问题。用户已在 159 列终端实机确认第三行生效、四个条目全部显示。

1. **定位(只读)**:`extension_statuses` 是**一个**段 —— `segments.ts:481-505` 把该会话全部扩展状态以 ` · ` 拼成一整条不可切分的内容,装箱算法看不到段内的单个条目。159 列终端下,顶行被左侧段与三个自定义段填满(158 列),`custom:tps`(29 列)与 `extension_statuses`(含 deep-plan 的 63 列中文文案时为 152 列,不含时为 84 列)进入次行;次行装下 `custom:tps` 后余额 128 列,容不下 152 列的状态段,旧代码 `break` 丢弃该段及其后的段。两个现象由此同一处解释。

2. **装箱改为三行**(`computeResponsiveLayout`,`index.ts:1075`):次行装不下的段改试第三行,首个三行都放不下的段之后的所有段一并丢弃(不截断)。段序在行间保持:一旦有段落入第三行,次行即封盘(`secondaryClosed`,`:1124-1136`),后续段不再回填次行。不加这一步时,后面的窄段会被放回次行、显示在溢出段之前 —— 4000 组随机(2–7 段 × 宽 4–83 × 终端宽 12–101)中有 137 组出现该乱序,例:`[41,34,37,5,7] @56` 渲染为 `0,1,3,4,2`。封盘的代价已量化:同批 4000 组中 77 组各少显示 1–2 段(共 89 段),无一组多显示。取舍是段序优先于显示量。

3. **接线**:`lastLayoutResult`(`:1240`)、`getResponsiveLayout` 的返回类型与 stale-ctx 复位(`:2793`、`:2829`)、`renderPowerlineSecondaryLines` 改为返回「次行 + 第三行」两行(`:2870-2874`;唯一消费者是 `powerline-secondary` widget 的 `measureWidget` 调用点 `:2982`,其 render 接受不定行数)。`computeResponsiveLayout` 改为 `export`,仅为可测。

4. **测试** `tests/responsive-layout.test.ts`(新增):宽度 200 落一行、90 落两行、45 落三行,三段各出现恰好一次;另加一条断言段序等于配置顺序的前缀、每行不超过给定宽度。第二条断言在改动前失败。

5. **文档** `FORK.md`:登记本 fork 相对上游的这条分歧 —— 上游自 v0.2.24 起为「次行装满即止、多出的段整段丢弃」,该语义由 `aed65b6` 引入且早于本 fork 的基点;同时记明乱序与少显示两处实测量。上游 `README.md`、`CHANGELOG.md` 仍描述两行语义,本 fork 未改这两份文件。

6. **验证**:`npm test` 226 例 / 221 通过 / 0 失败 / 5 跳过。类型检查本仓库未装 `typescript`,借 pi-deep-plan 的 `tsc 7.0.2` 加 `--typeRoots` 运行,所得错误与改动前的基线逐条相同共 4 条(`custom-status.ts:223`、`index.ts:1931-1932`、`working-vibes.ts:33`),改动区域零新增。装箱性质与段序的随机探针写在仓库根、以 `*.tmp.ts` 命名,运行后已删除。

7. **顺带修好的本机环境问题**:`node_modules/@earendil-works/` 下 `pi-coding-agent`、`pi-tui`、`pi-ai` 三个链接此前指向 macOS 路径 `/opt/homebrew/...`,在本机是断链,造成 47 例测试失败(`tests/working-vibes.test.ts:29-35` 以 `existsSync` 判断后重复 `symlinkSync`,报 EEXIST)。改指到本机真实安装(`C:\Users\28676\AppData\Local\nvm\v22.23.2\node_modules\@earendil-works\...`)后归零。`node_modules` 不入版本控制,该修复只存在于本机。上游两处写死 macOS 路径的测试助手(`tests/working-vibes.test.ts:29-35`、`tests/bash-mode.test.ts:52-53`)未改。

### 当前仓库状况

工作树:本轮改动的 3 个文件(`index.ts`、`FORK.md`、新增的 `tests/responsive-layout.test.ts`),加一处**早于本轮**就存在的 `package-lock.json` 改动(第 3112 行附近删掉一个 `"peer": true` 标志,属 npm 自行改写,已按用户选择并入本次第一次提交),再加本次交接写入的 `AGENTS.md`。两次提交均由本次交接发起:第一次提交前四项,第二次只提交 `AGENTS.md`。

起点是 `11ab930`(本 fork 上一轮加入 custom-status 发布器的提交),该提交的工作树是干净的。

### 未决问题

1. **条级溢出未实现**。用户问「为什么不是最后溢出的部分单独移到第三行」,原因是段粒度:该会话的全部扩展状态合成一个 `extension_statuses` 段,段内没有二次切分。要做到按条目逐条装箱,须让每个扩展状态各自成为一个段 id,随之改动动态注册、`hiddenExtensionStatusKeys`、`layout.*` 配置校验与排序,并影响所有扩展的既有配置。本轮未做,也未评估其影响面。

2. **上游未同步**。本条分歧未向上游提 issue 或 PR;`1e95b91` 之后上游是否改过这段装箱逻辑未核对,仅核对到 `aed65b6`(v0.2.24 那位祖先提交)。

### 后续任务

用户未指定后续任务。

2026-10-10 22:30 (+0800)
