/** My Projects: local folders analysed read-only; implement an agent only after reviewing and approving the exact plan. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ProjectAnalysis, type SkillRow, type VersionDetail } from "../api";
import { useT } from "../i18n";
import { Folder, Trash } from "../workspace/icons";
import { Button, Empty, ErrorNote, PageHeader, Pill, card, field, sectionTitle } from "../workspace/kit";
import { ProjectInstall } from "../workspace/ProjectInstall";

const KEY = "aab.projects";
// shortcut: remembered in this browser only (paths, no file contents); move to the backend when projects need sharing
function load(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function save(paths: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(paths)); } catch { /* storage blocked: the list just isn't remembered */ }
}

export function Projects() {
  const t = useT();
  const [paths, setPaths] = useState<string[]>(load);
  const [selected, setSelected] = useState<string | null>(paths[0] ?? null);
  const [input, setInput] = useState("");
  const analyze = useMutation({
    mutationFn: (path: string) => api<ProjectAnalysis>("/studio/projects/analyze", { method: "POST", body: JSON.stringify({ path }) }),
    onSuccess: (a) => { const next = [a.root, ...paths.filter((p) => p !== a.root)]; setPaths(next); save(next); setSelected(a.root); setInput(""); },
  });
  const forget = (p: string) => { const next = paths.filter((x) => x !== p); setPaths(next); save(next); if (selected === p) setSelected(next[0] ?? null); };

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t("nav.projects")} body={t("pr.body")} />
      <div className="grid gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <section aria-label={t("pr.list")} className="space-y-3">
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); analyze.mutate(input.trim()); }}>
            <label htmlFor="connect-path" className={sectionTitle}>{t("pr.connect")}</label>
            <input id="connect-path" className={`${field} font-mono text-[12.5px]`} placeholder={t("proj.pathPlaceholder")} value={input} onChange={(e) => setInput(e.target.value)} />
            <Button type="submit" className="w-full" disabled={!input.trim() || analyze.isPending}>{analyze.isPending ? t("proj.analyzing") : t("pr.connectBtn")}</Button>
            {analyze.error && <ErrorNote error={analyze.error} />}
          </form>
          <p className="text-[11px] text-faint">{t("pr.remembered")}</p>
          <ul className="space-y-1">
            {paths.map((p) => (
              <li key={p} className="flex items-center gap-1">
                <button type="button" onClick={() => setSelected(p)} aria-current={selected === p}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${selected === p ? "bg-hover text-ink" : "text-mute hover:bg-hover/60 hover:text-ink"}`}>
                  <Folder size={13} className="shrink-0" /><span className="truncate font-mono" title={p}>{p}</span>
                </button>
                <button type="button" onClick={() => forget(p)} aria-label={`${t("pr.forget")} ${p}`} title={t("pr.forget")}
                  className="grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink"><Trash size={12} /></button>
              </li>
            ))}
          </ul>
        </section>
        {selected ? <ProjectDetail key={selected} path={selected} /> : <Empty icon={<Folder size={16} />} title={t("pr.empty")} body={t("pr.emptyBody")} />}
      </div>
    </div>
  );
}

function ProjectDetail({ path }: { path: string }) {
  const t = useT();
  const info = useQuery({ queryKey: ["project", path], queryFn: () => api<ProjectAnalysis>("/studio/projects/analyze", { method: "POST", body: JSON.stringify({ path }) }) });
  const skills = useQuery({ queryKey: ["skills"], queryFn: () => api<SkillRow[]>("/studio/skills") });
  const usable = skills.data?.filter((s) => s.latest && s.latest.status !== "validation_failed") ?? [];  // never offer a failed agent
  const [agent, setAgent] = useState("");
  const version = useQuery({ queryKey: ["version", agent], queryFn: () => api<VersionDetail>(`/studio/versions/${agent}`), enabled: !!agent });
  const a = info.data;

  return (
    <div className="min-w-0 space-y-4">
      <section aria-label={t("pr.analysis")} className={`${card} p-4`}>
        <h2 className="truncate font-mono text-sm text-ink" title={path}>{path}</h2>
        {info.isPending && <p className="mt-2 text-xs text-mute">{t("proj.analyzing")}</p>}
        {info.error && <div className="mt-2"><ErrorNote error={info.error} /></div>}
        {a && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            <dt className="text-mute">{t("pr.languages")}</dt><dd className="flex flex-wrap gap-1">{a.languages.length ? a.languages.map((l) => <Pill key={l}>{l}</Pill>) : <span className="text-faint">{t("proj.nothingDetected")}</span>}</dd>
            <dt className="text-mute">{t("pr.frameworks")}</dt><dd className="flex flex-wrap gap-1">{a.frameworks.length ? a.frameworks.map((f) => <Pill key={f} tone="info">{f}</Pill>) : <span className="text-faint">—</span>}</dd>
            <dt className="text-mute">Git</dt><dd className="text-ink">{a.git ? <>{a.git.branch}{a.git.dirty && <Pill tone="warn">{t("proj.dirty")}</Pill>}</> : t("proj.noGit")}</dd>
          </dl>
        )}
      </section>
      <section aria-label={t("proj.title")} className={`${card} space-y-3 p-4`}>
        <label htmlFor="project-agent" className={sectionTitle}>{t("pr.agent")}</label>
        <select id="project-agent" value={agent} onChange={(e) => setAgent(e.target.value)} className={field}>
          <option value="">{t("pr.pickAgent")}</option>
          {usable.map((s) => <option key={s.id} value={s.latest!.id}>{s.slug}@{s.latest!.version} · {s.latest!.status}</option>)}
        </select>
        {version.data && <ProjectInstall key={version.data.id} v={version.data} path={path} />}
      </section>
    </div>
  );
}
