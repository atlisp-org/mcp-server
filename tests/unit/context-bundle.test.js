/**
 * context-bundle：一次 RPC 拿齐编排上下文。
 *
 * 页面侧和 relay-client 早就有合并包，直连部署（agent → mcp-server）没有，
 * ContextGatherer 只能回退成 5 次 resources/read。这里钉住：
 *   1. 默认包含 5 个 URI，?text=1 追加文本组合；
 *   2. 并发固定 ≤3（CAD COM 读不可重入，8 路并发会 No open document）；
 *   3. 单项失败只记 error，不影响其它项；
 *   4. 输出顺序与 URI 列表一致（agent 的顺序敏感）。
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildContextBundle,
  mapPool,
} from "../../src/handlers/resource-handlers.js";

describe("mapPool", () => {
  it("保持顺序且并发不超过上限", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      return n * 2;
    });

    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("空数组不启动 worker", async () => {
    const fn = vi.fn();
    expect(await mapPool([], 3, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("buildContextBundle", () => {
  const ok = (uri) => ({ uri, value: "x" });

  it("默认 5 项，按固定顺序返回，每项带 MCP 资源包装", async () => {
    const seen = [];
    const readOne = vi.fn(async (uri) => {
      seen.push(uri);
      return ok(uri);
    });

    const bundle = await buildContextBundle(readOne);
    const uris = bundle.items.map((i) => i.uri);

    expect(uris).toEqual([
      "atlisp://cad/info",
      "atlisp://dwg/name",
      "atlisp://dwg/path",
      "atlisp://dwg/context",
      "atlisp://dwg/analysis?type=summary",
    ]);
    expect(bundle.items[0].result.contents[0].text).toBe(
      JSON.stringify({ uri: "atlisp://cad/info", value: "x" }),
    );
    expect(seen).toHaveLength(5);
  });

  it("?text=1 追加 text-combined", async () => {
    const bundle = await buildContextBundle(async (uri) => uri, { text: "1" });

    expect(bundle.items.map((i) => i.uri)).toContain(
      "atlisp://dwg/text-combined",
    );
    expect(bundle.items).toHaveLength(6);
  });

  it("单项失败只记 error，其它项照常返回", async () => {
    const bundle = await buildContextBundle(async (uri) => {
      if (uri === "atlisp://dwg/context") throw new Error("No open document");
      return uri;
    });
    const byUri = Object.fromEntries(bundle.items.map((i) => [i.uri, i]));

    expect(byUri["atlisp://dwg/context"].error).toContain("No open document");
    expect(byUri["atlisp://dwg/context"].result).toBeUndefined();
    expect(byUri["atlisp://cad/info"].result).toBeTruthy();
  });

  it("二进制资源透传 blob", async () => {
    const bundle = await buildContextBundle(async (uri) =>
      uri === "atlisp://cad/info"
        ? { _blob: "AAAA", mimeType: "image/png" }
        : uri,
    );
    const info = bundle.items[0].result.contents[0];

    expect(info.blob).toBe("AAAA");
    expect(info.mimeType).toBe("image/png");
  });
});
