import { useState } from "react";
import { useLang, useT, type Key } from "./i18n";
import { ApiKeys } from "./workspace/ApiKeys";
import { Inspector } from "./workspace/Inspector";
import { Session, type Request } from "./workspace/Session";
import { Sidebar, type Page } from "./workspace/Sidebar";

type Pane = "nav" | "session" | "result";

/** Three-pane workspace on large screens; one pane at a time (switchable) below `lg`. */
export function App() {
  const t = useT();
  const { lang } = useLang();
  const [page, setPage] = useState<Page>("workspace");
  const [pane, setPane] = useState<Pane>("session");
  const [requests, setRequests] = useState<Request[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const open = (id: string, reveal = false) => { setOpenId(id); setPage("workspace"); if (reveal) setPane("result"); };
  const newSkill = () => {
    setPage("workspace"); setPane("session"); setRequests([]); setOpenId(null);
    requestAnimationFrame(() => document.getElementById("prompt")?.focus());
  };
  const show = (p: Pane) => (pane === p ? "flex" : "hidden");

  return (
    <div lang={lang} className="flex h-dvh flex-col overflow-hidden bg-canvas text-ink lg:grid lg:grid-cols-[248px_minmax(0,1fr)_minmax(380px,40%)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-20 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2">Skip to content</a>

      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2 lg:hidden" role="group" aria-label={t("ws.panes")}>
        {(["nav", "session", "result"] as Pane[]).map((p) => (
          <button key={p} type="button" aria-pressed={pane === p} onClick={() => setPane(p)}
            className={`relative h-8 flex-1 rounded-md text-[13px] ${pane === p ? "bg-hover text-ink" : "text-mute hover:text-ink"}`}>
            {t(`ws.pane.${p}` as Key)}
            {p === "result" && openId && pane !== "result" && <span aria-hidden="true" className="absolute right-3 top-2 h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      <aside aria-label="Sidebar" className={`${show("nav")} min-h-0 flex-1 flex-col border-line bg-panel lg:flex lg:border-r`}>
        <Sidebar page={page} openId={openId} onNew={newSkill} onOpenVersion={(id) => open(id, true)}
          onPage={(p) => { setPage(p); setPane("session"); }} />
      </aside>

      {page === "keys" ? (
        <main id="main" className={`${pane === "nav" ? "hidden" : "flex"} min-h-0 flex-1 flex-col overflow-y-auto lg:col-span-2 lg:flex`}>
          <ApiKeys />
        </main>
      ) : (
        <>
          <main id="main" className={`${show("session")} min-h-0 flex-1 flex-col lg:flex`}>
            <Session requests={requests} openId={openId} onOpen={open}
              onSubmit={(r) => setRequests((rs) => [...rs, r])} />
          </main>
          <aside aria-label={t("ws.pane.result")} className={`${show("result")} min-h-0 flex-1 flex-col border-line bg-panel lg:flex lg:border-l`}>
            <Inspector id={openId} onSelect={setOpenId} />
          </aside>
        </>
      )}
    </div>
  );
}
