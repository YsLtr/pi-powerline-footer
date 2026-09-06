/**
 * custom-status — 自定义状态发布器(合并自独立的 powerline-status 扩展)。
 *
 * 包含三个 status 发布器,均供 customItems / 其他扩展引用:
 *
 *   1. "context-bar" — 上下文占用:14 格进度条 + 占用量/窗口总量 + 百分比
 *      颜色阈值与原生 context 段一致:<70% 绿,70–90% 黄,>90% 红。
 *
 *   2. "req-stats" — 单次请求 token 用量与延迟:
 *      ↑ 发送(input+cache) ↓ 接收(output) 首=首字延迟 共=单次请求延迟 轮=整个 run 延迟
 *      保留旧值 + 数值变化时加粗闪烁;流式实时计数:Anthropic 协议用 provider
 *      精确 usage,OpenAI 兼容协议用估算(上下文占用估 ↑,delta 字符数估 ↓),~ 前缀标记。
 *
 *   3. "model-think" — 模型名+思考等级合并显示(如 hub/glm-5.3-flash:max):
 *      模型名用 model 色,后缀按原 thinking 段配色(min/low/med 主题色,high/xhigh/max 彩虹)。
 *
 * settings.json 端配置(statusKey 沿用,customItems 无需改动):
 *   customItems: [
 *     { id: "modelthink", statusKey: "model-think",   position: "left",  selfColorize: true },
 *     { id: "ctxbar",     statusKey: "context-bar",   position: "right", selfColorize: true },
 *     { id: "reqstats",   statusKey: "req-stats",     position: "right", selfColorize: true }
 *   ]
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/* ==================== 共用 ==================== */

const GREEN = 114; // ↑ 发送 tokens / 上下文 <70%
const CYAN = 80; // ↓ 接收 tokens
const YELLOW = 214; // 首字延迟 / 上下文 70–90%
const RED = 196; // 上下文 >90%
const WHITE = 250; // 请求总延迟
const LIGHT = 245; // 轮延迟(浅灰)
const DIM = 240; // 次要信息

const EST_CHARS_PER_TOKEN = 3; // 流式估算:中英混合输出的经验值
const FLASH_MS = 700; // req-stats 数值更新后的加粗提示时长
const MODEL_COLOR = "#d787af"; // 默认 model 段配色
const RAINBOW_COLORS = ["#b281d6", "#d787af", "#febc38", "#e4c00f", "#89d281", "#00afaf", "#178fb9", "#b281d6"];

// 用 \x1b[39m 而非 \x1b[0m 结束颜色,避免重置加粗属性(req-stats 加粗闪烁依赖)
const fg = (code: number, text: string) => `\x1b[38;5;${code}m${text}\x1b[39m`;
const fgHex = (hex: string, text: string) => {
	const h = hex.replace("#", "");
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
};
const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function fmtMs(ms: number): string {
	if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
	if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 1000).toFixed(2)}s`;
}

type Handler = (event: any, ctx: any) => void;

export function registerCustomStatus(pi: ExtensionAPI) {
	// 事件接线:各发布器向 handlers 注册,最后统一 pi.on,一个事件驱动多个发布器
	const handlers = new Map<string, Handler[]>();
	const on = (name: string, handler: Handler) => {
		const list = handlers.get(name) ?? [];
		list.push(handler);
		handlers.set(name, list);
	};

	/* ==================== context-bar:上下文占用 ==================== */

	{
		const BAR_WIDTH = 14;
		let lastBar = "";

		const renderBar = (usage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined): string => {
			const tokens = usage?.tokens;
			const window = usage?.contextWindow;
			const percent = usage?.percent;
			if (typeof tokens !== "number" || typeof percent !== "number") {
				return `${fg(DIM, "─".repeat(BAR_WIDTH))} ${fg(DIM, "--/--")}`;
			}
			const filled = Math.min(BAR_WIDTH, Math.max(0, Math.round((percent / 100) * BAR_WIDTH)));
			const color = percent > 90 ? RED : percent > 70 ? YELLOW : GREEN;
			const bar = fg(color, "█".repeat(filled)) + fg(DIM, "░".repeat(BAR_WIDTH - filled));
			const total = typeof window === "number" ? fmtTokens(window) : "?";
			return `${bar} ${fg(color, `${fmtTokens(tokens)}/${total} (${Math.round(percent)}%)`)}`;
		};

		const updateContextBar = (ctx: any) => {
			try {
				const bar = renderBar(ctx.getContextUsage());
				if (bar !== lastBar) {
					lastBar = bar;
					ctx.ui.setStatus("context-bar", bar);
				}
			} catch {
				// 无模型/会话时 getContextUsage 可能不可用,忽略
			}
		};

		// 覆盖:启动、模型切换、流式更新、消息完成、工具执行、回合结束、压缩前后
		for (const name of [
			"session_start",
			"session_info_changed",
			"model_select",
			"message_update",
			"message_end",
			"tool_execution_end",
			"turn_end",
			"session_before_compact",
			"session_compact",
			"session_compact_failed",
		]) {
			on(name, (_event: any, ctx: any) => updateContextBar(ctx));
		}
	}

	/* ==================== req-stats:单次请求 token/延迟 ==================== */

	{
		let last = ""; // 最近一次 setStatus 的完整字符串(含加粗态)
		let plain = ""; // 最近一次的常规文本(供 agent_end 追加、闪现回落)
		let flashUntil = 0; // 闪现窗口截止时刻
		let flashTimer: ReturnType<typeof setTimeout> | null = null;
		let runStart = 0; // 本次 agent run 起点(轮延迟基准)
		let runProduced = false; // 本次 run 是否产生过 assistant 消息
		let reqStart = 0; // 当前请求发出时刻(turn_start)
		let ttft: number | null = null; // 当前请求首字延迟
		let streaming = false;
		let deltaChars = 0; // 当前请求已流出的 delta 字符数(估算用)
		let sentEstimate: number | null = null; // turn_start 时估算的上下文发送量(OpenAI 兼容协议流式用)

		const setStatus = (ctx: any, text: string | undefined) => {
			if ((text ?? "") === last) return;
			last = text ?? "";
			try {
				ctx.ui.setStatus("req-stats", text);
			} catch {
				// UI 不可用时忽略
			}
		};

		// 更新显示。flash=true 时整行加粗 FLASH_MS 后回落;窗口内的静默更新
		// (流式计数)保持加粗渲染,避免闪烁被打断。
		const show = (ctx: any, text: string, flash = false) => {
			plain = text;
			if (flash) {
				flashUntil = Date.now() + FLASH_MS;
				if (flashTimer) clearTimeout(flashTimer);
				flashTimer = setTimeout(() => {
					flashTimer = null;
					setStatus(ctx, plain);
				}, FLASH_MS);
				setStatus(ctx, bold(text));
				return;
			}
			setStatus(ctx, Date.now() < flashUntil ? bold(text) : text);
		};

		// 外部(pi 核心 resetExtensionUI / reload / 会话切换等)可能清空扩展状态;
		// 新 run/turn 开始时强制重发上一次的数据,绕过去重缓存,避免显示消失。
		const republish = (ctx: any) => {
			if (!plain) return;
			last = "";
			setStatus(ctx, Date.now() < flashUntil ? bold(plain) : plain);
		};

		on("agent_start", (_event: any, ctx: any) => {
			runStart = Date.now();
			runProduced = false;
			republish(ctx);
		});

		// 新请求开始:保留上一次的显示不变;同时缓存发送量估算并防御性重发
		on("turn_start", (event: any, ctx: any) => {
			reqStart = typeof event?.timestamp === "number" ? event.timestamp : Date.now();
			ttft = null;
			streaming = true;
			deltaChars = 0;
			try {
				const usage = ctx?.getContextUsage?.();
				sentEstimate = typeof usage?.tokens === "number" && usage.tokens > 0 ? usage.tokens : null;
			} catch {
				sentEstimate = null;
			}
			republish(ctx);
		});

		// message_update 每个 token 都会触发:首字时记 TTFT 并闪烁,之后静默刷新实时计数
		on("message_update", (event: any, ctx: any) => {
			if (!streaming || event?.message?.role !== "assistant") return;
			const isFirstToken = ttft === null;
			if (isFirstToken) ttft = Math.max(0, Date.now() - reqStart);

			const parts: string[] = [fg(DIM, "…")];

			// ↑ 发送量:provider 流式中已报 usage(如 Anthropic)用精确值,
			// 否则用 turn_start 缓存的上下文占用估算
			const usage = event.message.usage ?? {};
			const sent = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
			if (sent > 0) parts.push(fg(GREEN, `↑${fmtTokens(sent)}`));
			else if (sentEstimate !== null) parts.push(fg(GREEN, `↑~${fmtTokens(sentEstimate)}`));

			// ↓ 接收量:provider 已报用精确值,否则用 delta 字符数估算
			if ((usage.output ?? 0) > 0) {
				parts.push(fg(CYAN, `↓${fmtTokens(usage.output)}`));
			} else {
				const ame = event.assistantMessageEvent;
				if (ame?.type === "text_delta" || ame?.type === "thinking_delta" || ame?.type === "toolcall_delta") {
					deltaChars += ame.delta?.length ?? 0;
				}
				const est = Math.round(deltaChars / EST_CHARS_PER_TOKEN);
				if (est > 0) parts.push(fg(CYAN, `↓~${fmtTokens(est)}`));
			}

			parts.push(fg(YELLOW, `首${fmtMs(ttft)}`));
			show(ctx, parts.join(" "), isFirstToken);
		});

		on("message_end", (event: any, ctx: any) => {
			const msg = event?.message;
			if (msg?.role !== "assistant") return;
			streaming = false;
			runProduced = true;
			const reqDur = Math.max(0, Date.now() - reqStart);
			const usage = msg.usage ?? {};
			const ttftText = ttft !== null ? fg(YELLOW, `首${fmtMs(ttft)}`) : fg(DIM, "首--");
			let text: string;
			if (typeof usage.input !== "number" && typeof usage.output !== "number") {
				// 出错/无 usage 时只显示延迟
				text = `${fg(DIM, "↑-- ↓--")} ${ttftText} ${fg(WHITE, `共${fmtMs(reqDur)}`)}`;
			} else {
				const sent = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
				const received = usage.output ?? 0;
				text = `${fg(GREEN, `↑${fmtTokens(sent)}`)} ${fg(CYAN, `↓${fmtTokens(received)}`)} `
					+ `${ttftText} ${fg(WHITE, `共${fmtMs(reqDur)}`)}`;
			}
			show(ctx, text, true);
		});

		on("agent_end", (_event: any, ctx: any) => {
			// 仅在本次 run 确实产生过 assistant 消息时追加轮延迟,避免污染上一次的数据
			if (!runStart || !runProduced || !plain) return;
			const runDur = Math.max(0, Date.now() - runStart);
			show(ctx, `${plain}${fg(LIGHT, ` 轮${fmtMs(runDur)}`)}`, true);
		});

		on("session_start", (_event: any, ctx: any) => {
			if (flashTimer) {
				clearTimeout(flashTimer);
				flashTimer = null;
			}
			flashUntil = 0;
			plain = "";
			runStart = 0;
			runProduced = false;
			reqStart = 0;
			ttft = null;
			streaming = false;
			deltaChars = 0;
			sentEstimate = null;
			setStatus(ctx, undefined);
		});
	}

	/* ==================== model-think:模型名+思考等级合并 ==================== */

	{
		const LEVEL_LABEL: Record<string, string> = {
			off: "off", minimal: "min", low: "low", medium: "med", high: "high", xhigh: "xhigh",
		};
		let lastMt = "";

		const rainbow = (text: string): string => {
			let result = "";
			let i = 0;
			for (const char of text) {
				if (char === " " || char === ":") {
					result += char;
				} else {
					result += fgHex(RAINBOW_COLORS[i % RAINBOW_COLORS.length]!, char);
					i++;
				}
			}
			return result;
		};

		const themeFg = (ctx: any, name: string, text: string): string => {
			try {
				return ctx.ui.theme.fg(name, text);
			} catch {
				return text;
			}
		};

		const updateModelThink = (ctx: any) => {
			try {
				const model = ctx?.model;
				// 模型名按 model.display=qualified 格式(provider/id)
				let name = model?.name || model?.id || "no-model";
				if (model?.id) {
					const provider = model.provider || model.providerId || model.providerName;
					name = provider && !model.id.includes("/") ? `${provider}/${model.id}` : model.id;
				}

				const level = (ctx?.thinkingLevel as string) || "off";
				let text = fgHex(MODEL_COLOR, name);
				// 与 thinking 段同规则:off 或非推理模型不显示后缀,
				// high/xhigh/max 彩虹色,minimal/low/medium 用各自主题色
				if (level !== "off" && (model as any)?.reasoning) {
					const think = `:${LEVEL_LABEL[level] ?? level}`;
					if (level === "high" || level === "xhigh" || level === "max") text += rainbow(think);
					else if (level === "minimal") text += themeFg(ctx, "thinkingMinimal", think);
					else if (level === "low") text += themeFg(ctx, "thinkingLow", think);
					else if (level === "medium") text += themeFg(ctx, "thinkingMedium", think);
					else text += themeFg(ctx, "thinkingOff", think);
				}
				if (text !== lastMt) {
					lastMt = text;
					ctx.ui.setStatus("model-think", text);
				}
			} catch {
				// 数据不可用时忽略
			}
		};

		for (const name of [
			"session_start",
			"session_info_changed",
			"model_select",
			"message_update",
			"message_end",
			"turn_start",
			"turn_end",
			"tool_execution_end",
		]) {
			on(name, (_event: any, ctx: any) => updateModelThink(ctx));
		}
	}

	/* ==================== 统一注册到 pi ==================== */

	for (const [name, list] of handlers) {
		pi.on(name as any, (event: unknown, ctx: any) => {
			for (const handler of list) handler(event, ctx);
		});
	}
}
