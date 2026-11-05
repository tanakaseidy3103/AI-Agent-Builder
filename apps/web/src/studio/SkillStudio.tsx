import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { API, api, type InstallInfo, type Integration, type Job, type Report, type SkillRow, type VersionDetail } from "../api";
import { Badge, Card, CopyBlock, ErrorBox, STATUS_HELP } from "./ui";

const EXAMPLE = "Create a Skill that analyzes React projects, detects performance problems, identifies unnecessary renders, and recommends optimizations.";

export function SkillStudio() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const job = useJob(jobId);

  useEffect(() => {
    if (job.data?.skill_version_id) setVersionId(job.data.skill_version_id);
  }, [job.data?.skill_version_id]);

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div className="space-y-6">
        <GenerateForm onStarted={(id) => { setJobId(id); setVersionId(null); }} />
        <SkillList selected={versionId} onSelect={(id) => { setVersionId(id); setJobId(null); }} />
      </div>
      <div className="space-y-6">
        {jobId && <Pipeline job={job.data} error={job.error} />}
        {versionId ? <VersionView id={versionId} onSelect={setVersionId} /> : !jobId && (
          <Card title="No Skill selected">
            <p className="text-sm text-slate-500">Describe a capability on the left, or pick an existing Skill.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function useJob(id: string | null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["job", id],
    queryFn: () => api<Job>(`/studio/jobs/${id}`),
    enabled: !!id,
    refetchInterval: (query) => (["queued", "running"].includes(query.state.data?.status ?? "queued") ? 1000 : false),
  });
  useEffect(() => {
    if (q.data?.status === "completed" || q.data?.status === "failed") qc.invalidateQueries({ queryKey: ["skills"] });
  }, [q.data?.status, qc]);
  return q;
}

function GenerateForm({ onStarted }: { onStarted: (jobId: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState("auto");
  const m = useMutation({
    mutationFn: () => api<Job>("/studio/skills/generate", { method: "POST", body: JSON.stringify({ prompt, kind }) }),
    onSuccess: (j) => onStarted(j.id),
  });
  return (
    <Card title="Skill Compiler">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <label className="block text-xs font-medium text-slate-600" htmlFor="prompt">Describe the capability</label>
        <textarea
          id="prompt"
          className="h-32 w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:outline-none"
          placeholder={EXAMPLE}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600" htmlFor="kind">Type</label>
          <select id="kind" className="rounded border border-slate-300 px-2 py-1 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="auto">Let the model decide</option>
            <option value="instructions">Instructions only</option>
            <option value="code">Needs executable code</option>
          </select>
          <button type="button" className="ml-auto text-xs text-indigo-700 hover:underline" onClick={() => setPrompt(EXAMPLE)}>
            Use example
          </button>
        </div>
        <button
          type="submit"
          disabled={prompt.trim().length < 10 || m.isPending}
          className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {m.isPending ? "Starting…" : "Generate Skill"}
        </button>
        {m.error && <ErrorBox error={m.error} />}
      </form>
    </Card>
  );
}

function SkillList({ selected, onSelect }: { selected: string | null; onSelect: (versionId: string) => void }) {
  const q = useQuery({ queryKey: ["skills"], queryFn: () => api<SkillRow[]>("/studio/skills") });
  return (
    <Card title="Skills">
      {q.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {q.error && <ErrorBox error={q.error} />}
      {q.data?.length === 0 && <p className="text-sm text-slate-500">No Skills yet.</p>}
      <ul className="divide-y divide-slate-100">
        {q.data?.map((s) => s.latest && (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.latest!.id)}
              className={`w-full py-2 text-left ${selected === s.latest.id ? "text-indigo-700" : "text-slate-800"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{s.slug}</span>
                <Badge status={s.latest.status} />
              </div>
              <span className="text-xs text-slate-500">v{s.latest.version} · {s.latest.kind} · {s.versions} version(s)</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Pipeline({ job, error }: { job?: Job; error: unknown }) {
  if (error) return <ErrorBox error={error} />;
  if (!job) return <Card title="Pipeline"><p className="text-sm text-slate-500">Loading…</p></Card>;
  return (
    <Card title="Generation pipeline" actions={<span className="text-xs text-slate-500">{job.provider ?? "queued"} · <Badge status={job.status} /></span>}>
      <ol className="space-y-2" aria-label="pipeline stages">
        {job.stages.map((s, i) => (
          <li key={s.name} className="flex items-start gap-3 text-sm">
            <span className="w-5 text-right text-xs text-slate-400">{i + 1}</span>
            <span className="w-36 font-mono text-xs text-slate-700">{s.name}</span>
            <Badge status={s.status} />
            <span className="flex-1 text-xs text-slate-500">{s.detail}{s.duration_ms ? ` · ${s.duration_ms} ms` : ""}</span>
          </li>
        ))}
      </ol>
      {job.status === "failed" && <div className="mt-3"><ErrorBox error={job.error} /></div>}
    </Card>
  );
}

type Tab = "files" | "manifest" | "validation" | "export";

function VersionView({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>("files");
  const q = useQuery({ queryKey: ["version", id], queryFn: () => api<VersionDetail>(`/studio/versions/${id}`) });
  if (q.isPending) return <Card title="Skill"><p className="text-sm text-slate-500">Loading…</p></Card>;
  if (q.error) return <ErrorBox error={q.error} />;
  const v = q.data;
  return (
    <Card
      title={`${v.manifest.name} · ${v.slug}@${v.version}`}
      actions={
        <select aria-label="version" className="rounded border border-slate-300 px-1 text-xs" value={id} onChange={(e) => onSelect(e.target.value)}>
          {v.versions.map((x) => <option key={x.id} value={x.id}>v{x.version} ({x.status})</option>)}
        </select>
      }
    >
      <div className="mb-4 flex items-center gap-2 text-sm">
        <Badge status={v.status} />
        <span className="text-slate-600">{STATUS_HELP[v.status]}</span>
      </div>
      <p className="mb-4 text-sm text-slate-700">{v.manifest.description}</p>
      <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
        {(["files", "manifest", "validation", "export"] as Tab[]).map((t) => (
          <button
            key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize ${tab === t ? "border-b-2 border-indigo-600 font-medium text-indigo-700" : "text-slate-500"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "files" && <Files v={v} />}
      {tab === "manifest" && <ManifestView v={v} />}
      {tab === "validation" && <Validation v={v} />}
      {tab === "export" && <Export v={v} />}
    </Card>
  );
}

function Files({ v }: { v: VersionDetail }) {
  const [path, setPath] = useState("SKILL.md");
  const q = useQuery({ queryKey: ["file", v.id, path], queryFn: () => api<string>(`/studio/versions/${v.id}/files/${path}`) });
  return (
    <div className="grid gap-4 md:grid-cols-[200px_1fr]">
      <ul className="space-y-1 font-mono text-xs" aria-label="package files">
        {v.files.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => setPath(f.path)} className={`w-full truncate rounded px-2 py-1 text-left ${path === f.path ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50"}`}>
              {f.path} <span className="text-slate-400">{f.size}B</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0">
        {q.error ? <ErrorBox error={q.error} /> : (
          <pre aria-label="file preview" className="max-h-[480px] overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-800">{q.data ?? "Loading…"}</pre>
        )}
      </div>
    </div>
  );
}

function ManifestView({ v }: { v: VersionDetail }) {
  const m = v.manifest;
  const row = (k: string, val: string[]) => (
    <div className="flex gap-2 py-1 text-sm"><dt className="w-32 text-slate-500">{k}</dt><dd>{val.length ? val.join(", ") : "none"}</dd></div>
  );
  return (
    <div className="space-y-4">
      <dl>
        {row("Kind", [m.kind])}
        {row("Permissions", m.permissions)}
        {row("Dependencies", m.dependencies)}
        {row("Agent tools", m.tools)}
        {row("Compatible with", m.compatibility)}
        {m.execution && row("Execution", [`${m.execution.entrypoint}`, `${m.execution.timeout_seconds}s`, `${m.execution.memory_mb} MB`])}
      </dl>
      <div className="grid gap-4 md:grid-cols-2">
        <CopyBlock label="Input schema" text={JSON.stringify(m.input_schema, null, 2)} />
        <CopyBlock label="Output schema" text={JSON.stringify(m.output_schema, null, 2)} />
      </div>
    </div>
  );
}

function Validation({ v }: { v: VersionDetail }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api<{ report: Report }>(`/studio/versions/${v.id}/validate`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["version", v.id] }); qc.invalidateQueries({ queryKey: ["skills"] }); },
  });
  const r = v.validation?.report;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => m.mutate()} disabled={m.isPending}
          className="rounded-lg border border-indigo-600 px-3 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
          {m.isPending ? "Validating…" : "Run validation"}
        </button>
        {r && <span className="text-xs text-slate-500">{r.static.passed} passed · {r.static.failed} failed · {r.static.warnings} warnings · {r.duration_ms} ms</span>}
      </div>
      {m.error && <ErrorBox error={m.error} />}
      {!r ? <p className="text-sm text-slate-500">No validation run yet.</p> : (
        <>
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500"><tr><th className="py-1">Check</th><th>Result</th><th>Details</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {r.static.checks.map((c) => (
                <tr key={c.id}><td className="py-1 pr-2 font-mono">{c.id}</td><td className="pr-2"><Badge status={c.status} /></td><td className="text-slate-600">{c.message}</td></tr>
              ))}
            </tbody>
          </table>
          <div>
            <h3 className="mb-1 text-xs font-semibold text-slate-700">
              Sandbox tests <Badge status={r.sandbox.status === "ran" ? "passed" : "skipped"} />{" "}
              <span className="font-normal text-slate-500">
                {r.sandbox.status === "ran" ? `${r.sandbox.duration_ms} ms · no network · 256 MB` : r.sandbox.error ?? "not run (instruction-only or static checks failed)"}
              </span>
            </h3>
            <ul className="space-y-1 text-xs">
              {r.tests.map((t) => (
                <li key={t.name}>
                  <Badge status={t.status} /> <span className="font-mono">{t.name}</span>
                  {t.detail && <pre className="mt-1 overflow-x-auto rounded bg-rose-50 p-2 text-rose-900">{t.detail}</pre>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Export({ v }: { v: VersionDetail }) {
  const targets = useQuery({ queryKey: ["integrations"], queryFn: () => api<Integration[]>("/studio/integrations") });
  const [target, setTarget] = useState("claude-code");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const exportable = v.status !== "generated";
  const info = useQuery({
    queryKey: ["install", v.id, target],
    queryFn: () => api<InstallInfo>(`/studio/versions/${v.id}/install/${target}`),
    enabled: exportable,
  });
  if (!exportable) return <ErrorBox error="This version failed validation and cannot be exported. Fix the failing checks and generate a new version." />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="target" className="text-sm text-slate-600">Target</label>
        <select id="target" className="rounded border border-slate-300 px-2 py-1 text-sm" value={target} onChange={(e) => { setTarget(e.target.value); setConfirmReplace(false); }}>
          {targets.data?.filter((t) => t.id === "canonical" || v.manifest.compatibility.includes(t.id)).map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <a className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          href={`${API}/studio/versions/${v.id}/export/${target}`} download={info.data?.zip}>
          Download ZIP
        </a>
      </div>
      {info.error && <ErrorBox error={info.error} />}
      {info.data && (
        <>
          <p className="text-sm text-slate-600">{info.data.target.notes}</p>
          <p className="text-xs text-slate-500">1. Download <code>{info.data.zip}</code> · 2. From the download folder, run:</p>
          <CopyBlock label="Install (bash) — refuses to overwrite" text={info.data.install.bash} />
          <CopyBlock label="Install (PowerShell) — refuses to overwrite" text={info.data.install.powershell} />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
            Show replace commands (an installed copy exists)
          </label>
          {confirmReplace && (
            <>
              <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">{info.data.replace.warning}</p>
              <CopyBlock label="Replace (bash)" text={info.data.replace.bash} />
              <CopyBlock label="Replace (PowerShell)" text={info.data.replace.powershell} />
            </>
          )}
          <p className="text-xs italic text-slate-500">{info.data.note}</p>
        </>
      )}
    </div>
  );
}
