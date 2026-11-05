import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => vi.unstubAllGlobals());

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
}

it("shows API status from /health", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok" }))));
  renderApp();
  expect(await screen.findByText("API: ok")).toBeTruthy();
});

it("shows offline when API fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
  renderApp();
  expect(await screen.findByText("API: offline")).toBeTruthy();
});
