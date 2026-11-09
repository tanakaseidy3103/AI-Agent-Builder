/** Left navigation. Every value shown here (recent projects, model, API state) comes from the backend. */
import { useQuery } from "@tanstack/react-query";
import { api, type Job, type Models } from "../api";
import { useLang, useT, type Key } from "../i18n";
import { href, type PageId } from "../route";
import { Alert, Chip, CodeI, Cube, Flask, Folder, Gear, Globe, Grid, Plug, Plus, Spark } from "./icons";
import { sectionTitle, toneOf } from "./kit";

const NAV: [PageId, typeof Spark][] = [
  ["overview", Grid], ["studio", Spark], ["agents", Cube], ["code", CodeI],
  ["projects", Folder], ["evaluations", Flask], ["integrations", Plug], ["settings", Gear],
];
const DOT: Record<string, string> = { ok: "bg-ok", info: "bg-info", warn: "bg-warn", bad: "bg-bad", accent: "bg-accent", mute: "bg-faint" };

export function Sidebar({ page, onNew, onNavigate }: { page: PageId; onNew: () => void; onNavigate?: () => void }) {
  const t = useT();
  const { lang, setLang } = useLang();
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<Job[]>("/studio/jobs") });
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ status: string }>("/health") });
  const models = useQuery({ queryKey: ["models"], queryFn: () => api<Models>("/studio/models"), staleTime: Infinity });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent-ink ring-1 ring-inset ring-accent/30"><Spark size={14} /></span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink">AI Agent Builder</p>
          <p className="truncate text-[11px] text-faint">{t("app.slogan")}</p>
        </div>
      </div>
      <div className="px-3 pb-3">
        <button type="button" onClick={onNew}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-sm font-medium text-white transition-colors hover:bg-accent/90">
          <Plus size={14} />{t("ws.new")}
        </button>
      </div>

      <nav aria-label="Main" className="space-y-px px-2">
        {NAV.map(([p, Icon]) => (
          <a key={p} href={href(p)} onClick={onNavigate} aria-current={page === p ? "page" : undefined}
            className={`flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors ${page === p ? "bg-hover text-ink" : "text-mute hover:bg-hover/60 hover:text-ink"}`}>
            <Icon size={15} className={page === p ? "text-accent-ink" : ""} />{t(`nav.${p}` as Key)}
          </a>
        ))}
      </nav>

      <div className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        {health.isError && (
          <p role="alert" className="mx-1 flex gap-2 rounded-md border border-bad/25 bg-bad/[0.07] px-2.5 py-2 text-[12px] leading-snug text-ink/90">
            <Alert size={14} className="mt-0.5 shrink-0 text-bad" /><span>{t("ws.apiDown")}</span>
          </p>
        )}
        <section aria-label={t("ws.recent")}>
          <h2 className={`${sectionTitle} px-2 pb-1`}>{t("ws.recent")}</h2>
          {jobs.data?.length === 0 && <p className="px-2 text-xs text-faint">{t("ws.noRecent")}</p>}
          <ul className="space-y-px">
            {jobs.data?.slice(0, 5).map((j) => (
              <li key={j.id}>
                <a href={j.skill_version_id ? href("code", j.skill_version_id) : href("studio")} onClick={onNavigate} title={j.prompt}
                  className="flex items-start gap-2 rounded-md px-2 py-1 text-[12px] text-mute transition-colors hover:bg-hover/60 hover:text-ink">
                  <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[toneOf(j.status)]}`} />
                  <span className="line-clamp-2">{j.prompt}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="space-y-2 border-t border-line px-3 py-3 text-[11.5px]">
        <a href={href("settings")} onClick={onNavigate} className="flex items-center gap-2 text-mute hover:text-ink" title={models.data?.error ?? t("ws.modelHelp")}>
          <Chip size={13} /><span className="truncate font-mono">{models.data?.default ?? t("ws.modelUnknown")}</span>
          {(models.data?.error || (models.data && !models.data.installed.includes(models.data.default))) &&
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" role="img" aria-label={models.data.error ?? t("int.defaultMissing", { model: models.data.default })} />}
        </a>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-mute" role="status">
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${health.isError ? "bg-bad" : health.isPending ? "bg-faint" : "bg-ok"}`} />
            {t("api.status")}: {health.isPending ? t("api.checking") : health.isError ? t("api.offline") : health.data.status}
          </p>
          <button type="button" onClick={() => setLang(lang === "ja" ? "en" : "ja")} lang={lang === "ja" ? "en" : "ja"}
            className="flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-mute hover:bg-hover hover:text-ink">
            <Globe size={12} />{t("lang.toggle")}
          </button>
        </div>
      </div>
    </div>
  );
}
