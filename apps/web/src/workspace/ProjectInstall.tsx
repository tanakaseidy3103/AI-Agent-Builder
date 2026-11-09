/**
 * Implement in my project: analyse read-only -> proposal -> review files and diff -> approve/reject -> apply in a new
 * branch -> optional sandbox tests -> result with rollback. Nothing is written without approval; no project command runs.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ProjectPlan, type ProjectResult, type Report, type VersionDetail } from "../api";
import { useT, type Key } from "../i18n";
import { Check, Flask } from "./icons";
import { Button, Code, CopyField, ErrorNote, Pill, StatusPill, field, sectionTitle } from "./kit";

const PROJECT_TARGETS = [["claude-code", "Claude Code"], ["codex", "OpenAI Codex"], ["cursor", "Cursor"]] as const;
const STEPS: Key[] = ["proj.s.analyze", "proj.s.proposal", "proj.s.review", "proj.s.approve", "proj.s.apply", "proj.s.test", "proj.s.result"];

export function ProjectInstall({ v, path: fixedPath }: { v: VersionDetail; path?: string }) {
  const t = useT();
  const targets = PROJECT_TARGETS.filter(([id]) => v.manifest.compatibility.includes(id));
  const [typed, setPath] = useState("");
  const path = fixedPath ?? typed;
  const [target, setTarget] = useState<string>(targets[0]?.[0] ?? "claude-code");
  const body = { path: path.trim(), target };
  const url = `/studio/versions/${v.id}/project`;
  const plan = useMutation({ mutationFn: () => api<ProjectPlan>(`${url}/plan`, { method: "POST", body: JSON.stringify(body) }) });
  const apply = useMutation({
    mutationFn: (token: string) => api<ProjectResult>(`${url}/apply`, { method: "POST", body: JSON.stringify({ ...body, token }) }),
  });
  // the agent's own unit tests and eval cases, re-run in the isolated sandbox (never inside the user's project)
  const tests = useMutation({ mutationFn: () => api<{ report: Report }>(`/studio/versions/${v.id}/validate`, { method: "POST" }) });
  const reset = () => { plan.reset(); apply.reset(); tests.reset(); };
  const p = plan.data;
  const done = apply.data;
  const step = !p ? 0 : !done ? 2 : !tests.data ? 5 : 6;

  return (
    <section aria-label={t("proj.title")} className="space-y-3">
      <div>
        <h3 className={sectionTitle}>{t("proj.title")}</h3>
        <p className="mt-1 text-xs leading-relaxed text-mute">{t("proj.body")}</p>
      </div>
      <ol aria-label={t("proj.steps")} className="flex flex-wrap gap-x-1 gap-y-1 text-[12px]">
        {STEPS.map((k, i) => (
          <li key={k} data-step={i} data-state={i < step ? "done" : i === step ? "current" : "todo"}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${i < step ? "text-ok" : i === step ? "bg-accent/12 text-accent-ink" : "text-faint"}`}>
            {i < step ? <Check size={11} /> : <span className="tabular-nums">{i + 1}.</span>}{t(k)}
          </li>
        ))}
      </ol>
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); reset(); plan.mutate(); }}>
        {fixedPath ? <p className="min-w-0 flex-1 self-center truncate font-mono text-[12.5px] text-ink">{fixedPath}</p> : <>
          <label htmlFor="project-path" className="sr-only">{t("proj.path")}</label>
          <input id="project-path" className={`${field} min-w-0 flex-1 font-mono text-[12.5px]`} placeholder={t("proj.pathPlaceholder")}
            value={path} onChange={(e) => { setPath(e.target.value); reset(); }} />
        </>}
        <label htmlFor="project-target" className="sr-only">{t("export.target")}</label>
        <select id="project-target" value={target} onChange={(e) => { setTarget(e.target.value); reset(); }}
          className="h-9 rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-accent/60 focus:outline-none">
          {targets.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <Button type="submit" disabled={!path.trim() || plan.isPending}>{plan.isPending ? t("proj.analyzing") : t("proj.analyze")}</Button>
      </form>
      {plan.error && <ErrorNote error={plan.error} />}

      {p && !done && (
        <div className="space-y-3 rounded-md border border-line p-3" data-testid="project-plan">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-mute">{t("proj.detected")}</dt>
            <dd className="text-ink">{[...p.analysis.languages, ...p.analysis.frameworks].join(", ") || t("proj.nothingDetected")}</dd>
            <dt className="text-mute">Git</dt>
            <dd className="text-ink">{p.analysis.git ? `${p.analysis.git.branch}${p.analysis.git.dirty ? ` · ${t("proj.dirty")}` : ""}` : t("proj.noGit")}</dd>
            <dt className="text-mute">{t("proj.branch")}</dt>
            <dd className="font-mono text-ink">{p.branch ?? t("proj.noBranch")}</dd>
          </dl>
          <div>
            <p className="mb-1 text-xs text-mute">{t("proj.files", { n: p.files.length, dest: p.dest })}</p>
            <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded border border-line bg-canvas" aria-label={t("proj.diff")}>
              {p.files.map((f) => <DiffFile key={f.path} v={v} dest={p.dest} path={f.path} bytes={f.bytes} />)}
            </ul>
            <p className="mt-1 text-[12px] text-faint">{t("proj.onlyNew")}</p>
          </div>
          {p.blockers.map((b) => <ErrorNote key={b} error={b} />)}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={p.blockers.length > 0 || apply.isPending} onClick={() => apply.mutate(p.token)}>
              {apply.isPending ? t("proj.applying") : t("proj.approve", { n: p.files.length })}
            </Button>
            <Button variant="quiet" disabled={apply.isPending} onClick={reset}>{t("plan.reject")}</Button>
          </div>
          {apply.error && <ErrorNote error={apply.error} />}
        </div>
      )}

      {done && (
        <div className="space-y-2 rounded-md border border-ok/25 bg-ok/[0.05] p-3" role="status">
          <p className="flex items-center gap-2 text-sm text-ink"><Check size={14} className="text-ok" />
            {t("proj.done", { n: done.created.length })} {done.branch && <Pill tone="ok">{done.branch}</Pill>}</p>
          <p className="text-xs text-mute">{done.branch ? t("proj.review", { branch: done.branch }) : t("proj.reviewNoGit")}</p>
          <div className="space-y-1.5 rounded-md border border-line bg-canvas p-2.5">
            <p className="text-[12.5px] text-mute">{t("proj.tests")}</p>
            <Button size="sm" disabled={tests.isPending} onClick={() => tests.mutate()}><Flask size={13} />{tests.isPending ? t("ag.testing") : t("proj.runTests")}</Button>
            {tests.error && <ErrorNote error={tests.error} />}
            {tests.data && <TestSummary r={tests.data.report} />}
          </div>
          <CopyField label={t("proj.rollbackBash")} text={done.rollback.bash} />
          <CopyField label={t("proj.rollbackPs")} text={done.rollback.powershell} />
        </div>
      )}
    </section>
  );
}

/** One planned new file; its content (the whole diff, all added lines) is fetched only when opened. */
function DiffFile({ v, dest, path, bytes }: { v: VersionDetail; dest: string; path: string; bytes: number }) {
  const [open, setOpen] = useState(false);
  const rel = path.slice(dest.length + 1);
  const q = useQuery({ queryKey: ["file", v.id, rel], queryFn: () => api<string>(`/studio/versions/${v.id}/files/${rel}`), enabled: open });
  return (
    <li>
      <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="flex cursor-pointer items-center gap-2 px-2 py-1 font-mono text-[12px] hover:bg-hover/60">
          <span className="text-ok">+</span><span className="min-w-0 flex-1 truncate text-ink/90">{path}</span><span className="text-faint">{bytes} B</span>
        </summary>
        <div className="max-h-72 overflow-auto border-l-2 border-ok/50 bg-ok/[0.03] px-1 py-1.5">
          {q.error ? <ErrorNote error={q.error} /> : q.data !== undefined ? <Code text={q.data} path={rel} lineNumbers /> : null}
        </div>
      </details>
    </li>
  );
}

function TestSummary({ r }: { r: Report }) {
  const t = useT();
  const pass = (xs: { status: string }[]) => xs.filter((x) => x.status === "pass").length;
  return (
    <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink" data-testid="project-tests">
      <StatusPill status={r.status} />
      {t("ev.counts", { tp: pass(r.tests), tt: r.tests.length, ep: pass(r.evals ?? []), et: r.evals?.length ?? 0 })}
    </p>
  );
}
