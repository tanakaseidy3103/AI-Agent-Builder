/**
 * Hash routes (#/agents, #/code/<versionId>/<tab>, #/code/<versionId>/files/<path>/<start>-<end>): deep links and
 * back/forward without a router dependency. Each segment is URI-encoded, so a file path is one segment.
 */
import { useEffect, useState } from "react";

export const PAGES = ["overview", "studio", "agents", "code", "projects", "evaluations", "integrations", "settings"] as const;
export type PageId = (typeof PAGES)[number];
export interface Route { page: PageId; id?: string; tab?: string; file?: FileTarget }
/** A file (and optionally a line range, 1-based inclusive) to open in the Code Workspace. */
export interface FileTarget { path: string; start?: number; end?: number }

function parseLines(s?: string): Pick<FileTarget, "start" | "end"> {
  const m = /^(\d+)(?:-(\d+))?$/.exec(s ?? "");
  if (!m) return {};
  const start = Number(m[1]), end = Number(m[2] ?? m[1]);
  return start > 0 && end >= start ? { start, end } : {};
}

export function parseHash(hash: string): Route {
  const [page, id, tab, path, lines] = hash.replace(/^#\/?/, "").split("/").map((s) => { try { return decodeURIComponent(s); } catch { return ""; } });
  return {
    page: (PAGES as readonly string[]).includes(page) ? (page as PageId) : "overview", id: id || undefined, tab: tab || undefined,
    ...(path ? { file: { path, ...parseLines(lines) } } : {}),
  };
}

export const href = (page: PageId, id?: string, tab?: string, file?: FileTarget) => {
  const lines = file?.start ? (file.end && file.end !== file.start ? `${file.start}-${file.end}` : `${file.start}`) : undefined;
  return `#/${[page, id, tab, file?.path, lines].filter(Boolean).map((s) => encodeURIComponent(s!)).join("/")}`;
};
export const go = (page: PageId, id?: string, tab?: string) => { window.location.hash = href(page, id, tab); };

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
