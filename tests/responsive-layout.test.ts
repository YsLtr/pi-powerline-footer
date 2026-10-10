import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { computeResponsiveLayout } from "../index.ts";
import { getPreset } from "../presets.ts";
import type { CustomStatusItem, SegmentContext, StatusLineSegmentId } from "../types.ts";

const preset = getPreset("default");

// 自定义段的宽度由 statusKey 对应的状态文本长度决定,内容不依赖会话状态。
// 每段以 `#i#` 开头,便于从渲染结果里还原段的出现顺序。
function customItem(id: string): CustomStatusItem {
  return {
    id,
    statusKey: id,
    position: "right",
    selfColorize: true,
    hideWhenMissing: true,
    excludeFromExtensionStatuses: true,
  };
}

function layout(widths: number[], availableWidth: number): { rows: string[]; sequence: number[] } {
  const statuses = new Map<string, string>();
  const items = new Map<string, CustomStatusItem>();
  widths.forEach((width, index) => {
    const id = `s${index}`;
    const marker = `#${index}#`;
    statuses.set(id, marker + ".".repeat(Math.max(0, width - marker.length)));
    items.set(id, customItem(id));
  });
  const ctx = { customItemsById: items, extensionStatuses: statuses } as unknown as SegmentContext;
  const ids = widths.map((_, index) => `custom:s${index}`) as StatusLineSegmentId[];
  const computed = computeResponsiveLayout(ctx, preset, ids, availableWidth);
  const rows = [computed.topContent, computed.secondaryContent, computed.tertiaryContent].filter((row) => row);

  const sequence: number[] = [];
  for (const row of rows) {
    const hits: { at: number; index: number }[] = [];
    widths.forEach((_, index) => {
      const at = row.indexOf(`#${index}#`);
      if (at >= 0) hits.push({ at, index });
    });
    for (const hit of hits.sort((a, b) => a.at - b.at)) sequence.push(hit.index);
  }

  return { rows, sequence };
}

const WIDTH = 40;
const statuses = new Map([
  ["a", "a".repeat(WIDTH)],
  ["b", "b".repeat(WIDTH)],
  ["c", "c".repeat(WIDTH)],
]);

const ctx = {
  customItemsById: new Map(["a", "b", "c"].map((id) => [id, customItem(id)])),
  extensionStatuses: statuses,
} as unknown as SegmentContext;

const ids = ["custom:a", "custom:b", "custom:c"] as StatusLineSegmentId[];

function rows(width: number): string[] {
  const computed = computeResponsiveLayout(ctx, preset, ids, width);
  return [computed.topContent, computed.secondaryContent, computed.tertiaryContent].filter((line) => line);
}

test("overflow segments continue on the tertiary row instead of being dropped", () => {
  assert.equal(rows(200).length, 1, "all segments fit on the top row");
  assert.equal(rows(90).length, 2, "second segment overflows to the secondary row");
  assert.equal(rows(45).length, 3, "third segment overflows to the tertiary row");

  const joined = rows(45).join("");
  for (const value of statuses.values()) {
    assert.equal(joined.split(value).length - 1, 1, `${value.slice(0, 1)} appears exactly once`);
  }
});

test("segments keep their configured order across the three rows", () => {
  // 这段宽度组合在「次行可随时回填」的装箱下渲染为 0,1,3,4,2 —— 后面的窄段被放回次行,
  // 显示在溢出段之前。段序必须等于配置顺序的前缀。
  const { rows: rendered, sequence } = layout([41, 34, 37, 5, 7], 56);

  assert.ok(sequence.length > 0, "至少渲染一个段");
  assert.deepEqual(
    sequence,
    Array.from({ length: sequence.length }, (_, index) => index),
    "渲染顺序等于配置顺序的前缀,不因回填次行而错位",
  );

  for (const row of rendered) {
    assert.ok(visibleWidth(row) <= 56, `row fits: ${visibleWidth(row)} <= 56`);
  }
});
