/** Hash routes (#/agents, #/code/<versionId>/<tab>): deep links and back/forward without a router dependency. */
import { useEffect, useState } from "react";

export const PAGES = ["overview", "studio", "agents", "code", "projects", "evaluations", "integrations", "settings"] as const;
export type PageId = (typeof PAGES)[number];
export interface Route { page: PageId; id?: string; tab?: string }

export function parseHash(hash: string): Route {
  const [page, id, tab] = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  return { page: (PAGES as readonly string[]).includes(page) ? (page as PageId) : "overview", id: id || undefined, tab: tab || undefined };
}

export const href = (page: PageId, id?: string, tab?: string) => `#/${[page, id, tab].filter(Boolean).map((s) => encodeURIComponent(s!)).join("/")}`;
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
