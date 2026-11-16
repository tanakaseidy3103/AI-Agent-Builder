// Render submission/project-proposal.html to project-proposal.pdf with the repository's Playwright Chromium and
// enforce the proposal limits. Run from the repository root:  node hackathons/ugreen-2026/scripts/build_proposal.mjs
// Limits (as stated by the participant; confirm on the Devpost form): English, <= 500 words, <= 1 MB.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const SUB = join(dirname(fileURLToPath(import.meta.url)), "..", "submission");
const html = join(SUB, "project-proposal.html");
const pdf = join(SUB, "project-proposal.pdf");
const MAX_WORDS = 500, MAX_BYTES = 1_000_000;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(html).href);
// words as a reader sees them: rendered text of the whole page, split on whitespace
const text = await page.evaluate(() => document.body.innerText);
const words = text.split(/\s+/).filter(Boolean).length;
await page.pdf({ path: pdf, format: "A4", printBackground: true, tagged: true, outline: true });
await browser.close();

const bytes = statSync(pdf).size;
const head = readFileSync(pdf).subarray(0, 5).toString();
const pages = (readFileSync(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
const result = { pdf: "project-proposal.pdf", words, maxWords: MAX_WORDS, bytes, maxBytes: MAX_BYTES, pages, isPdf: head === "%PDF-",
  pass: words <= MAX_WORDS && bytes <= MAX_BYTES && head === "%PDF-" };
writeFileSync(join(SUB, "proposal-validation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`${result.pass ? "PASS" : "FAIL"}  words ${words}/${MAX_WORDS}  size ${bytes}/${MAX_BYTES} bytes  pages ${pages}  pdf header ${head}`);
process.exitCode = result.pass ? 0 : 1;
