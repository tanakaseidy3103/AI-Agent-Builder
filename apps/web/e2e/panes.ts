import type { Page } from "@playwright/test";

/** Below `lg` only one workspace pane is visible; switch to it. No-op on desktop, where all three are shown. */
export async function pane(page: Page, name: string) {
  const button = page.getByRole("group", { name: /Panels|パネル/ }).getByRole("button", { name, exact: true });
  if (await button.isVisible()) await button.click();
}
