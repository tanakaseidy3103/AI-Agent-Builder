import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api";
import { useLang, useT, type Key } from "./i18n";
import { AgentStudio } from "./studio/AgentStudio";
import { ApiKeys } from "./studio/ApiKeys";
import { SkillList, VersionView } from "./studio/SkillStudio";
import { Card } from "./studio/ui";

type Page = "create" | "skills" | "keys";

export function App() {
  const t = useT();
  const { lang, setLang } = useLang();
  const [page, setPage] = useState<Page>("create");
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ status: string }>("/health") });

  return (
    <div className="studio-backdrop min-h-screen text-slate-200">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-ink-800 focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b border-white/5 bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-brand to-blue-brand text-sm font-bold text-white">A</span>
            <div>
              <h1 className="text-sm font-semibold text-white">AI Agent Builder</h1>
              <p className="hidden text-[11px] text-slate-400 md:block">{t("app.tagline")}</p>
            </div>
          </div>
          <nav aria-label="Main" className="flex gap-1 text-sm">
            {(["create", "skills", "keys"] as Page[]).map((p) => (
              <button key={p} type="button" onClick={() => setPage(p)} aria-current={page === p ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 ${page === p ? "bg-white/10 font-medium text-white" : "text-slate-400 hover:text-slate-100"}`}>
                {t(`nav.${p}` as Key)}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <p className="text-slate-400" role="status">
              {t("api.status")}: {health.isPending ? t("api.checking") : health.isError ? t("api.offline") : health.data.status}
            </p>
            <button type="button" onClick={() => setLang(lang === "ja" ? "en" : "ja")} lang={lang === "ja" ? "en" : "ja"}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-slate-200 hover:bg-white/5">
              {t("lang.toggle")}
            </button>
          </div>
        </div>
      </header>
      <main id="main" lang={lang} className="mx-auto max-w-7xl px-4 py-6">
        {page === "create" && <AgentStudio />}
        {page === "skills" && <SkillsPage />}
        {page === "keys" && <ApiKeys />}
      </main>
    </div>
  );
}

function SkillsPage() {
  const t = useT();
  const [versionId, setVersionId] = useState<string | null>(null);
  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <SkillList selected={versionId} onSelect={setVersionId} />
      {versionId ? <VersionView id={versionId} onSelect={setVersionId} /> : (
        <Card title={t("skills.title")}><p className="text-sm text-slate-400">{t("skills.select")}</p></Card>
      )}
    </div>
  );
}
