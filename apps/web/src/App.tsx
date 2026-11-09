import { useEffect, useState } from "react";
import { useLang, useT, type Key } from "./i18n";
import { Agents } from "./pages/Agents";
import { Code } from "./pages/Code";
import { Evaluations } from "./pages/Evaluations";
import { Integrations } from "./pages/Integrations";
import { Overview } from "./pages/Overview";
import { Projects } from "./pages/Projects";
import { Settings } from "./pages/Settings";
import { Studio, clearStudioSession, type Draft } from "./pages/Studio";
import { go, useRoute } from "./route";
import { Cross, Menu } from "./workspace/icons";
import { Sidebar } from "./workspace/Sidebar";

/** App shell: sidebar (a drawer below `lg`) + the routed page. The Studio stays mounted so a running conversation survives navigation. */
export function App() {
  const t = useT();
  const { lang } = useLang();
  const route = useRoute();
  const [drawer, setDrawer] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [studioKey, setStudioKey] = useState(0);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const newAgent = () => { clearStudioSession(); setStudioKey((k) => k + 1); setDraft(undefined); setDrawer(false); go("studio"); requestAnimationFrame(() => document.getElementById("prompt")?.focus()); };
  const edit = (text: string) => { setDraft((d) => ({ text, n: (d?.n ?? 0) + 1 })); go("studio"); };
  const page = route.page;

  return (
    <div lang={lang} className="flex h-dvh overflow-hidden bg-canvas text-ink">
      <a href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-30 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2">Skip to content</a>

      {drawer && <div aria-hidden="true" className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setDrawer(false)} />}
      <aside aria-label="Sidebar" id="sidebar"
        className={`${drawer ? "fixed inset-y-0 left-0 z-30 flex w-64 shadow-xl" : "hidden"} min-h-0 flex-col border-r border-line bg-panel lg:static lg:flex lg:w-[232px] lg:shrink-0 lg:shadow-none`}>
        <Sidebar page={page} onNew={newAgent} onNavigate={() => setDrawer(false)} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 lg:hidden">
          <button type="button" onClick={() => setDrawer(!drawer)} aria-expanded={drawer} aria-controls="sidebar" aria-label={t("ws.menu")}
            className="grid h-8 w-8 place-items-center rounded-md text-mute hover:bg-hover hover:text-ink">{drawer ? <Cross size={15} /> : <Menu size={16} />}</button>
          <span className="truncate text-[13px] font-medium text-ink">{t(`nav.${page}` as Key)}</span>
        </div>
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 focus:outline-none">
          <div className={page === "studio" ? "h-full" : "hidden"}><Studio draft={draft} resetKey={studioKey} /></div>
          {page === "overview" && <Overview />}
          {page === "agents" && <Agents onEdit={edit} />}
          {page === "code" && <Code id={route.id} tab={route.tab} />}
          {page === "projects" && <Projects />}
          {page === "evaluations" && <Evaluations />}
          {page === "integrations" && <Integrations />}
          {page === "settings" && <Settings />}
        </main>
      </div>
    </div>
  );
}
