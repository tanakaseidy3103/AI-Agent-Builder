import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { LangProvider } from "./i18n";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderApp(health: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/health" ? health()
    : url === "/api/studio/models" ? json({ default: "qwen2.5-coder:latest", installed: [], error: null }) : json([]))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LangProvider lang="en"><App /></LangProvider></QueryClientProvider>);
}

it("shows API status from /health", async () => {
  renderApp(() => json({ status: "ok" }));
  expect(await screen.findByText("API: ok")).toBeTruthy();
});

it("shows offline when API fails", async () => {
  renderApp(() => new Response("", { status: 500 }));
  expect(await screen.findByText("API: offline")).toBeTruthy();
});
