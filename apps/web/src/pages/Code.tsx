/** Code Workspace: pick an agent, browse and copy its files, see dependencies and setup, download or export. */
import { useQuery } from "@tanstack/react-query";
import { api, type SkillRow } from "../api";
import { useT, type Key } from "../i18n";
import { go, href } from "../route";
import { Inspector } from "../workspace/Inspector";
import { Empty, ErrorNote, field, toneOf } from "../workspace/kit";
import { CodeI } from "../workspace/icons";

const DOT: Record<string, string> = { ok: "bg-ok", info: "bg-info", warn: "bg-warn", bad: "bg-bad", accent: "bg-accent", mute: "bg-faint" };

export function Code({ id, tab }: { id?: string; tab?: string }) {
  const t = useT();
  const skills = useQuery({ queryKey: ["skills"], queryFn: () => api<SkillRow[]>("/studio/skills") });
  const current = id ?? skills.data?.find((s) => s.latest)?.latest?.id;
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav aria-label={t("nav.agents")} className="shrink-0 border-b border-line bg-panel py-2 md:w-56 md:overflow-y-auto md:border-b-0 md:border-r">
        <h1 className="px-3 pb-1.5 text-[13px] font-semibold text-ink">{t("nav.code")}</h1>
        {skills.error && <div className="px-3"><ErrorNote error={skills.error} /></div>}
        {/* small screens: one compact picker so the code keeps the screen */}
        <div className="px-3 md:hidden">
          <label htmlFor="code-agent" className="sr-only">{t("pr.agent")}</label>
          <select id="code-agent" value={current ?? ""} onChange={(e) => go("code", e.target.value)} className={field}>
            {skills.data?.map((s) => s.latest && <option key={s.id} value={s.latest.id}>{s.slug} · {t(`st.${s.latest.status}` as Key)}</option>)}
          </select>
        </div>
        {skills.data?.map((s) => s.latest && (
          <a key={s.id} href={href("code", s.latest.id)} aria-current={current === s.latest.id ? "page" : undefined}
            className={`hidden h-7 items-center gap-2 px-3 text-[12.5px] md:flex ${current === s.latest.id ? "bg-hover text-ink" : "text-mute hover:bg-hover/60 hover:text-ink"}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[toneOf(s.latest.status)]}`} />
            <span className="truncate">{s.slug}</span>
          </a>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 bg-panel">
        {current ? <Inspector key={`${current}/${tab ?? ""}`} id={current} tab={tab} onSelect={(v) => go("code", v, tab)} />
          : skills.data && <Empty icon={<CodeI size={16} />} title={t("code.empty")} body={t("skills.empty")} />}
      </div>
    </div>
  );
}
