import type { Page } from "@playwright/test";

/** Below `lg` the Studio shows one pane at a time (Build / Result); switch to it. No-op on desktop. */
export async function pane(page: Page, name: string) {
  const button = page.getByRole("group", { name: /Panels|パネル/ }).getByRole("button", { name, exact: true });
  if (await button.isVisible()) await button.click();
}

/** Click a main navigation item; below `lg` the sidebar is a drawer behind the menu button. */
export async function nav(page: Page, name: string) {
  const link = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true });
  if (!(await link.isVisible())) await page.getByRole("button", { name: /^(Menu|メニュー)$/ }).click();
  await link.click();
}

/** Advanced composer options are collapsed by default (progressive disclosure). Opening is idempotent. */
export async function advanced(page: Page) {
  await page.locator("details", { hasText: /Advanced|詳細設定/ }).first().evaluate((d) => ((d as HTMLDetailsElement).open = true));
}

/** Open a generated file: a dropdown on small screens, the file tree on large ones. */
export async function openFile(page: Page, path: string) {
  const picker = page.locator("#file-pick");
  if (await picker.isVisible()) await picker.selectOption(path);
  else await page.getByRole("button", { name: path.split("/").pop()!, exact: true }).click();
}
