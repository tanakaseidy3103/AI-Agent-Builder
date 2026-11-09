/** My Agents: every stored Skill with its real status, evidence and model; open, edit, test, export, delete. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api, type EvalSkill, type Job, type SkillRow } from "../api";
import { useT } from "../i18n";
import { go, href } from "../route";
import { reached } from "../workspace/evidence";
import { CodeI, Download, Flask, Pencil, Plus, Trash } from "../workspace/icons";
import { Button, Empty, ErrorNote, PageHeader, StatusPill, card, field } from "../workspace/kit";
import { Ladder } from "../workspace/Ladder";
import { when } from "./Overview";

export function Agents({ onEdit }: { onEdit: (text: string) => void }) {
  const t = useT();
  const skills = useQuery({ queryKey: ["skills"], queryFn: () => api<SkillRow[]>("/studio/skills") });
  const evals = useQuery({ queryKey: ["evaluations"], queryFn: () => api<EvalSkill[]>("/studio/evaluations") });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<Job[]>("/studio/jobs") });
  const byVersion = new Map((evals.data ?? []).flatMap((s) => s.versions.map((v) => [v.version_id, v] as const)));
  const [deleting, setDeleting] = useState<SkillRow | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<"updated" | "name">("updated");
  const q = query.trim().toLowerCase();
  const shown = (skills.data ?? [])
    .filter((s) => s.latest && (status === "all" || s.latest.status === status))
    .filter((s) => !q || `${s.name} ${s.slug} ${s.description}`.toLowerCase().includes(q))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : (b.latest!.created_at ?? "").localeCompare(a.latest!.created_at ?? ""));

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t("nav.agents")} body={t("ag.body")}>
        <a href={href("studio")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90"><Plus size={14} />{t("ws.new")}</a>
      </PageHeader>
      <div className="space-y-3 px-4 py-5 sm:px-6">
        {skills.error && <ErrorNote error={skills.error} />}
        {skills.isPending && <p className="text-sm text-mute">{t("skills.loading")}</p>}
        {skills.data?.length === 0 && <Empty icon={<Plus size={16} />} title={t("ag.empty")} body={t("skills.empty")} />}
        {!!skills.data?.length && (
          <div className="flex flex-wrap items-center gap-2" role="search">
            <label htmlFor="agent-search" className="sr-only">{t("ag.search")}</label>
            <input id="agent-search" type="search" className={`${field} max-w-xs`} placeholder={t("ag.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
            <label htmlFor="agent-status" className="sr-only">{t("ev.filter")}</label>
            <select id="agent-status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-md border border-line bg-raised px-2 text-sm text-ink">
              <option value="all">{t("ev.all")}</option>
              {(["verified", "validated", "validation_failed"] as const).map((st) => <option key={st} value={st}>{t(`st.${st}`)}</option>)}
            </select>
            <label htmlFor="agent-sort" className="sr-only">{t("ag.sort")}</label>
            <select id="agent-sort" value={sort} onChange={(e) => setSort(e.target.value as "updated" | "name")} className="h-9 rounded-md border border-line bg-raised px-2 text-sm text-ink">
              <option value="updated">{t("ag.sortUpdated")}</option>
              <option value="name">{t("ag.sortName")}</option>
            </select>
            <span className="text-xs text-faint" role="status">{t("ag.count", { n: shown.length, total: skills.data.length })}</span>
          </div>
        )}
        {skills.data && skills.data.length > 0 && shown.length === 0 && <Empty title={t("ag.noMatch")} />}
        <ul className="grid gap-3 xl:grid-cols-2">
          {shown.map((s) => s.latest && (
            <AgentCard key={s.id} s={s} ev={byVersion.get(s.latest.id)}
              prompt={jobs.data?.find((j) => j.skill_version_id === s.latest!.id)?.prompt}
              onEdit={onEdit} onDelete={() => setDeleting(s)} />
          ))}
        </ul>
      </div>
      {deleting && <ConfirmDelete s={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function AgentCard({ s, ev, prompt, onEdit, onDelete }: {
  s: SkillRow; ev?: EvalSkill["versions"][number]; prompt?: string; onEdit: (text: string) => void; onDelete: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const v = s.latest!;
  const test = useMutation({
    mutationFn: () => api<{ status: string }>(`/studio/versions/${v.id}/validate`, { method: "POST" }),
    onSuccess: () => ["skills", "evaluations", "version"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
  const exportable = v.status !== "validation_failed";
  return (
    <li className={`${card} flex min-w-0 flex-col gap-3 p-4`} data-testid={`agent-${s.slug}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a href={href("code", v.id)} className="text-sm font-semibold text-ink hover:text-accent-ink">{s.name}</a>
          <p className="truncate font-mono text-[11.5px] text-faint">{s.slug}@{v.version} · {v.kind} · {t("ag.versions", { n: s.versions })}</p>
        </div>
        <StatusPill status={v.status} />
      </div>
      <p className="line-clamp-2 text-[12.5px] text-mute">{s.description}</p>
      {ev ? <Ladder levels={reached(v.status, ev.criteria, ev.tests_total + ev.evals_total > 0)} /> : <p className="text-[11px] text-faint">{t("ag.noEval")}</p>}
      <p className="flex flex-wrap gap-x-3 text-[11px] text-faint">
        <span className="font-mono">{ev?.model ?? "—"}</span><span>{t("ag.updated")} {when(v.created_at)}</span>
      </p>
      {test.error && <ErrorNote error={test.error} />}
      {test.data && <p className="text-xs text-mute" role="status">{t("ag.tested", { status: test.data.status })}</p>}
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-line pt-3">
        <Button size="sm" onClick={() => go("code", v.id)}><CodeI size={13} />{t("ag.open")}</Button>
        <Button size="sm" variant="quiet" onClick={() => onEdit(prompt ? `${prompt}\n\n${t("chat.correction")}: ` : `${s.description}\n\n${t("chat.correction")}: `)}>
          <Pencil size={13} />{t("ag.edit")}</Button>
        <Button size="sm" variant="quiet" disabled={test.isPending} onClick={() => test.mutate()}><Flask size={13} />{test.isPending ? t("ag.testing") : t("ag.test")}</Button>
        <Button size="sm" variant="quiet" disabled={!exportable} title={exportable ? undefined : t("export.blocked")} onClick={() => go("code", v.id, "export")}>
          <Download size={13} />{t("ag.export")}</Button>
        <Button size="sm" variant="quiet" className="ml-auto text-bad hover:text-bad" onClick={onDelete} aria-label={`${t("ag.delete")} ${s.slug}`}><Trash size={13} />{t("ag.delete")}</Button>
      </div>
    </li>
  );
}

function ConfirmDelete({ s, onClose }: { s: SkillRow; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [typed, setTyped] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const del = useMutation({
    mutationFn: () => api<void>(`/studio/skills/${s.id}`, { method: "DELETE" }),
    onSuccess: () => { ["skills", "evaluations", "jobs"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onClose(); },
  });
  return (
    <dialog ref={(d) => { ref.current = d; if (d && !d.open) d.showModal?.(); }} onClose={onClose} aria-labelledby="del-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-line bg-panel p-5 text-ink backdrop:bg-black/60">
      <h2 id="del-title" className="text-base font-semibold">{t("ag.deleteTitle", { name: s.name })}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-mute">{t("ag.deleteBody", { n: s.versions })}</p>
      <label htmlFor="del-confirm" className="mt-4 block text-xs text-mute">{t("ag.deleteType", { slug: s.slug })}</label>
      <input id="del-confirm" autoFocus className={`${field} mt-1 font-mono`} value={typed} onChange={(e) => setTyped(e.target.value)} />
      {del.error && <div className="mt-3"><ErrorNote error={del.error} /></div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="quiet" onClick={() => ref.current?.close()}>{t("ag.cancel")}</Button>
        <button type="button" disabled={typed !== s.slug || del.isPending} onClick={() => del.mutate()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bad px-3 text-sm font-medium text-canvas disabled:opacity-40">
          <Trash size={13} />{t("ag.deleteConfirm")}
        </button>
      </div>
    </dialog>
  );
}
