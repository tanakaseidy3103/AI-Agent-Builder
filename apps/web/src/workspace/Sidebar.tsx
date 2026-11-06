/** Left: navigation, new request, saved Skills, previous requests, model, language and API status. All real data. */
import { useQuery } from "@tanstack/react-query";
import { api, type Job, type SkillRow } from "../api";
import { useLang, useT } from "../i18n";
import { Chip, Globe, Key, Plus, Spark } from "./icons";
import { Button, sectionTitle, toneOf } from "./kit";

export type Page = "workspace" | "keys";

const DOT: Record<string, string> = { ok: "bg-ok", info: "bg-info", warn: "bg-warn", bad: "bg-bad", accent: "bg-accent", mute: "bg-faint" };

export function Sidebar({ page, onPage, onNew, onOpenVersion, openId }: {
  page: Page; onPage: (p: Page) => void; onNew: () => void; onOpenVersion: (id: string) => void; openId: string | null;
}) {
  const t = useT();
  const { lang, setLang } = useLang();
  const skills = useQuery({ queryKey: ["skills"], queryFn: () => api<SkillRow[]>("/studio/skills") });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<Job[]>("/studio/jobs") });
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ status: string }>("/health") });
  const model = jobs.data?.find((j) => j.provider)?.provider;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent-ink ring-1 ring-inset ring-accent/30"><Spark size={14} /></span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink">AI Agent Builder</p>
          <p className="truncate text-[11px] text-faint">{t("ws.product")}</p>
        </div>
      </div>
      <div className="px-3 pb-3">
        <Button variant="primary" className="w-full" onClick={onNew}><Plus size={14} />{t("ws.new")}</Button>
      </div>

      <nav aria-label="Main" className="space-y-0.5 px-2">
        {([["workspace", t("nav.create"), Spark], ["keys", t("nav.keys"), Key]] as const).map(([p, label, Icon]) => (
          <button key={p} type="button" onClick={() => onPage(p)} aria-current={page === p ? "page" : undefined}
            className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${page === p ? "bg-hover text-ink" : "text-mute hover:bg-hover/60 hover:text-ink"}`}>
            <Icon size={14} />{label}
          </button>
        ))}
      </nav>

      <div className="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto px-2 pb-3">
        <section aria-label={t("skills.title")}>
          <h2 className={`${sectionTitle} px-2 pb-1`}>{t("skills.title")}</h2>
          {skills.isPending && <p className="px-2 text-xs text-faint">{t("skills.loading")}</p>}
          {skills.data?.length === 0 && <p className="px-2 text-xs leading-relaxed text-faint">{t("skills.empty")}</p>}
          <ul className="space-y-px">
            {skills.data?.map((s) => s.latest && (
              <li key={s.id}>
                <button type="button" onClick={() => onOpenVersion(s.latest!.id)} aria-current={openId === s.latest.id}
                  title={`${s.slug}@${s.latest.version} · ${s.latest.status}`}
                  className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors ${openId === s.latest.id ? "bg-hover text-ink" : "text-mute hover:bg-hover/60 hover:text-ink"}`}>
                  <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[toneOf(s.latest.status)]}`} />
                  <span className="truncate">{s.slug}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] text-faint">v{s.latest.version}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label={t("ws.recent")}>
          <h2 className={`${sectionTitle} px-2 pb-1`}>{t("ws.recent")}</h2>
          {jobs.data?.length === 0 && <p className="px-2 text-xs text-faint">{t("ws.noRecent")}</p>}
          <ul className="space-y-px">
            {jobs.data?.slice(0, 8).map((j) => (
              <li key={j.id}>
                <button type="button" disabled={!j.skill_version_id} onClick={() => j.skill_version_id && onOpenVersion(j.skill_version_id)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-[12px] text-mute transition-colors hover:bg-hover/60 hover:text-ink disabled:cursor-default disabled:hover:bg-transparent">
                  <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[toneOf(j.status)]}`} />
                  <span className="line-clamp-2">{j.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="space-y-2 border-t border-line px-3 py-3 text-[11.5px]">
        <p className="flex items-center gap-2 text-mute" title={t("ws.modelHelp")}>
          <Chip size={13} /><span className="truncate font-mono">{model ?? t("ws.modelUnknown")}</span>
        </p>
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
