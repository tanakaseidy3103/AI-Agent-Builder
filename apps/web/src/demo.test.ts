/** Demo-mode API client: base URL, /studio → /demo mapping, anonymous session header, renewal, offline messages.
 * Each test re-imports api.ts with the build-time env it needs (import.meta.env is read at module load). */
import { afterEach, describe, expect, it, vi } from "vitest";

type Call = { url: string; headers: Headers; method: string };

async function load(env: Record<string, string>, responses: (Response | Error)[]) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: new Headers(init?.headers), method: init?.method ?? "GET" });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch " + url);
    if (next instanceof Error) throw next;
    return next;
  }));
  localStorage.clear();
  return { mod: await import("./api"), calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("local mode (default build)", () => {
  it("keeps the same-origin /api base, the /studio paths and sends no session header", async () => {
    const { mod, calls } = await load({}, [json([])]);
    expect(mod.API).toBe("/api");
    expect(mod.DEMO).toBe(false);
    await mod.api("/studio/skills");
    expect(calls[0].url).toBe("/api/studio/skills");
    expect(calls[0].headers.has("X-Demo-Session")).toBe(false);
  });
});

describe("demo mode", () => {
  const env = { VITE_DEMO_MODE: "true", VITE_API_BASE: "https://random-words.trycloudflare.com/" };

  it("uses the configured backend, maps /studio to /demo and attaches a fresh session token", async () => {
    const { mod, calls } = await load(env, [json({ token: "demo_abc" }, 201), json([])]);
    expect(mod.API).toBe("https://random-words.trycloudflare.com");
    await mod.api("/studio/skills");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://random-words.trycloudflare.com/demo/session",
      "GET https://random-words.trycloudflare.com/demo/skills",
    ]);
    expect(calls[1].headers.get("X-Demo-Session")).toBe("demo_abc");
    expect(localStorage.getItem("aab-demo-session")).toBe("demo_abc");
  });

  it("reuses the stored session and renews it once on 401", async () => {
    const { mod, calls } = await load(env, [json({ detail: "expired" }, 401), json({ token: "demo_new" }, 201), json([])]);
    localStorage.setItem("aab-demo-session", "demo_old");
    await mod.api("/studio/jobs");
    expect(calls[0].headers.get("X-Demo-Session")).toBe("demo_old");
    expect(calls[1].url.endsWith("/demo/session")).toBe(true);
    expect(calls[2].headers.get("X-Demo-Session")).toBe("demo_new");
  });

  it("the public status call needs no session", async () => {
    const { mod, calls } = await load(env, [json({ model_ready: true })]);
    await mod.api("/demo/status");
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.has("X-Demo-Session")).toBe(false);
  });

  it("a network failure becomes a plain 'demo server offline' error", async () => {
    const { mod } = await load(env, [new TypeError("Failed to fetch")]);
    await expect(mod.api("/demo/status")).rejects.toMatchObject({ status: 0, message: expect.stringContaining("may be offline") });
  });

  it("a Cloudflare tunnel error page (530) is explained, not shown as raw HTML", async () => {
    const { mod } = await load(env, [new Response("<html>error 1033</html>", { status: 530 })]);
    await expect(mod.api("/demo/status")).rejects.toMatchObject({ status: 530, message: expect.stringContaining("may be offline") });
  });

  it("server messages such as rate limits are shown as written", async () => {
    const { mod } = await load(env, [json({ detail: "too many requests; try again in 12 s" }, 429)]);
    await expect(mod.api("/demo/status")).rejects.toMatchObject({ status: 429, message: "too many requests; try again in 12 s" });
  });
});

describe("homelab: one origin and the presentation access code (2026-11-14)", () => {
  const env = { VITE_DEMO_MODE: "true", VITE_API_BASE: "/" };

  it("VITE_API_BASE=/ keeps every call on the page's own origin (one tunnel URL, no rebuild when it changes)", async () => {
    const { mod, calls } = await load(env, [json({ token: "demo_x" }, 201), json([])]);
    expect(mod.API).toBe("");
    await mod.api("/studio/skills");
    expect(calls.map((c) => c.url)).toEqual(["/demo/session", "/demo/skills"]);
  });

  it("sends the access code only after the visitor typed it, and only to the demo API", async () => {
    const { mod, calls } = await load(env, [json({ token: "demo_x" }, 201), json([]), json([])]);
    sessionStorage.clear();
    await mod.api("/studio/skills");
    expect(calls[1].headers.has("X-Demo-Code")).toBe(false);
    mod.setDemoCode("hackathon-2026");
    await mod.api("/studio/skills");
    expect(calls[2].headers.get("X-Demo-Code")).toBe("hackathon-2026");
    mod.setDemoCode("");
    expect(mod.demoCode()).toBe("");
  });

  it("local mode never sends it", async () => {
    const { mod, calls } = await load({}, [json([])]);
    sessionStorage.setItem("aab-demo-code", "hackathon-2026");
    await mod.api("/studio/skills");
    expect(calls[0].headers.has("X-Demo-Code")).toBe(false);
    sessionStorage.clear();
  });
});
