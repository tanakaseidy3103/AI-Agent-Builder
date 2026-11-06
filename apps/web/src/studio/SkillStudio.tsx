/** Skill inspection views (files, manifest, validation, export) shared by the Create and Skills pages. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { API, api, type InstallInfo, type Integration, type Job, type Report, type SkillRow, type VersionDetail } from "../api";
import { useT, type Key } from "../i18n";
import { Badge, Card, CopyBlock, ErrorBox, ghostBtn, primaryBtn } from "./ui";

export function useJob(id: string | null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["job", id],
    queryFn: () => api<Job>(`/studio/jobs/${id}`),
    enabled: !!id,
    refetchInterval: (query) => (["draft", "generating"].includes(query.state.data?.status ?? "draft") ? 1000 : false),
  });
  useEffect(() => {
    if (q.data?.status === "completed" || q.data?.status === "failed") qc.invalidateQueries({ queryKey: ["skills"] });
  }, [q.data?.status, qc]);
  return q;
}

export function SkillList({ selected, onSelect }: { selected: string | null; onSelect: (versionId: string) => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["skills"], queryFn: () => api<SkillRow[]>("/studio/skills") });
  return (
    <Card title={t("skills.title")}>
      {q.isPending && <p className="text-sm text-slate-400">{t("skills.loading")}</p>}
      {q.error && <ErrorBox error={q.error} />}
      {q.data?.length === 0 && <p className="text-sm text-slate-400">{t("skills.empty")}</p>}
      <ul className="-mx-2 space-y-1">
        {q.data?.map((s) => s.latest && (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.latest!.id)}
              aria-current={selected === s.latest.id}
              className={`w-full rounded-xl px-2 py-2 text-left transition-colors ${selected === s.latest.id ? "bg-white/8" : "hover:bg-white/5"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-slate-100">{s.slug}</span>
                <Badge status={s.latest.status} />
              </div>
              <span className="text-xs text-slate-500">v{s.latest.version} · {s.latest.kind} · {t("skills.versions", { n: s.versions })}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

type Tab = "files" | "manifest" | "validation" | "export";

export function VersionView({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("files");
  const q = useQuery({ queryKey: ["version", id], queryFn: () => api<VersionDetail>(`/studio/versions/${id}`) });
  if (q.isPending) return <Card title="Skill"><p className="text-sm text-slate-400">{t("skills.loading")}</p></Card>;
  if (q.error) return <ErrorBox error={q.error} />;
  const v = q.data;
  return (
    <Card
      title={`${v.manifest.name} · ${v.slug}@${v.version}`}
      actions={
        <select aria-label={t("version")} className="rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-xs text-slate-200" value={id}
          onChange={(e) => onSelect(e.target.value)}>
          {v.versions.map((x) => <option key={x.id} value={x.id}>v{x.version} ({x.status})</option>)}
        </select>
      }
    >
      <div className="mb-3 flex items-start gap-2 text-sm">
        <Badge status={v.status} />
        <span className="text-slate-300">{t(`status.${v.status}` as Key)}</span>
      </div>
      <EvidenceLadder v={v} />
      <p className="mb-4 text-sm text-slate-400">{v.manifest.description}</p>
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-white/8">
        {(["files", "manifest", "validation", "export"] as Tab[]).map((x) => (
          <button
            key={x} role="tab" aria-selected={tab === x} type="button" onClick={() => setTab(x)}
            className={`whitespace-nowrap px-3 py-2 text-sm ${tab === x ? "border-b-2 border-violet-brand font-medium text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
          >
            {t(`tab.${x}` as Key)}
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

/** What has actually been proven for this version, derived only from the stored validation report. */
function EvidenceLadder({ v }: { v: VersionDetail }) {
  const t = useT();
  const r = v.validation?.report;
  const steps: [Key, boolean][] = [
    ["ev.generated", true],
    ["ev.validated", v.status !== "validation_failed"],
    ["ev.tested", r?.sandbox.status === "ran"],
    ["ev.verified", v.status === "verified"],
  ];
  return (
    <ol aria-label={t("ev.title")} className="mb-4 flex flex-wrap gap-2 text-xs">
      {steps.map(([k, ok]) => (
        <li key={k} data-reached={ok}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 text-slate-500"}`}>
          <span aria-hidden="true">{ok ? "✓" : "○"}</span>{t(k)}
        </li>
      ))}
    </ol>
  );
}

function Files({ v }: { v: VersionDetail }) {
  const t = useT();
  const [path, setPath] = useState("SKILL.md");
  const q = useQuery({ queryKey: ["file", v.id, path], queryFn: () => api<string>(`/studio/versions/${v.id}/files/${path}`) });
  return (
    <div className="grid gap-4 md:grid-cols-[210px_1fr]">
      <ul className="space-y-1 font-mono text-xs" aria-label={t("files.label")}>
        {v.files.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => setPath(f.path)}
              className={`w-full truncate rounded-lg px-2 py-1.5 text-left ${path === f.path ? "bg-violet-brand/15 text-violet-200" : "text-slate-300 hover:bg-white/5"}`}>
              {f.path} <span className="text-slate-500">{f.size}B</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0">
        {q.error ? <ErrorBox error={q.error} /> : (
          <pre aria-label={t("files.preview")} className="max-h-[480px] overflow-auto rounded-xl border border-white/5 bg-ink-950 p-3 font-mono text-xs text-slate-200">
            {q.data ?? t("skills.loading")}
          </pre>
        )}
      </div>
    </div>
  );
}

function ManifestView({ v }: { v: VersionDetail }) {
  const t = useT();
  const m = v.manifest;
  const row = (k: Key, val: string[]) => (
    <div className="flex gap-3 py-1 text-sm">
      <dt className="w-36 shrink-0 text-slate-500">{t(k)}</dt><dd className="text-slate-200">{val.length ? val.join(", ") : t("manifest.none")}</dd>
    </div>
  );
  return (
    <div className="space-y-4">
      <dl>
        {row("manifest.kind", [m.kind])}
        {row("manifest.permissions", m.permissions)}
        {row("manifest.dependencies", m.dependencies)}
        {row("manifest.tools", m.tools)}
        {row("manifest.compat", m.compatibility)}
        {m.execution && row("manifest.exec", [m.execution.entrypoint, `${m.execution.timeout_seconds}s`, `${m.execution.memory_mb} MB`])}
      </dl>
      <div className="grid gap-4 md:grid-cols-2">
        <CopyBlock label={t("manifest.input")} text={JSON.stringify(m.input_schema, null, 2)} />
        <CopyBlock label={t("manifest.output")} text={JSON.stringify(m.output_schema, null, 2)} />
      </div>
    </div>
  );
}

function short(value: unknown) {
  const s = JSON.stringify(value);
  return s && s.length > 220 ? `${s.slice(0, 220)}…` : s ?? "null";
}

function Validation({ v }: { v: VersionDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api<{ report: Report }>(`/studio/versions/${v.id}/validate`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["version", v.id] }); qc.invalidateQueries({ queryKey: ["skills"] }); },
  });
  const r = v.validation?.report;
  const failed = r?.static.checks.filter((c) => c.status === "fail") ?? [];
  const sandboxNote = !r ? "" : r.sandbox.status === "ran"
    ? t("val.sandboxRan", { ms: r.sandbox.duration_ms ?? 0, mb: r.sandbox.limits?.memory_mb ?? "?" })
    : r.sandbox.error ?? (v.kind === "instructions" ? t("val.sandboxSkippedInstr") : t("val.sandboxSkippedStatic"));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => m.mutate()} disabled={m.isPending} className={ghostBtn}>
          {m.isPending ? t("val.running") : t("val.run")}
        </button>
        {r && <span className="text-xs text-slate-400">
          {t("val.summary", { passed: r.static.passed, failed: r.static.failed, warnings: r.static.warnings, ms: r.duration_ms })}
          {r.repair_rounds !== undefined && ` · ${t("val.repairs")}: ${r.repair_rounds}`}
        </span>}
      </div>
      {m.error && <ErrorBox error={m.error} />}
      {!r ? <p className="text-sm text-slate-400">{t("val.none")}</p> : (
        <>
          {r.failure_category && r.failure_category !== "none" && (
            <div role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-100">
              {t(`cat.${r.failure_category}` as Key)}
            </div>
          )}
          {failed.length > 0 && (
            <ul className="space-y-2" aria-label={t("val.howToFix")}>
              {failed.map((c) => (
                <li key={c.id} className="rounded-xl border border-rose-400/15 bg-rose-500/5 p-3 text-xs">
                  <div className="font-mono text-rose-200">{c.id}</div>
                  <div className="mt-1 text-slate-300">{c.message}</div>
                  {c.hint && <div className="mt-2 text-slate-200"><span className="font-semibold text-amber-200">{t("val.howToFix")}: </span>{c.hint}</div>}
                </li>
              ))}
            </ul>
          )}
          {r.criteria && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{t("val.criteria")}</h3>
              <ul className="grid gap-2 sm:grid-cols-3">
                {r.criteria.map((c) => (
                  <li key={c.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-xs">
                    <div className="mb-1 flex items-center justify-between"><span className="font-mono text-slate-200">{c.id}</span><Badge status={c.passed ? "pass" : "fail"} /></div>
                    <div className="text-slate-400">{c.detail}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-400"><span className="font-semibold text-slate-200">{t("val.sandbox")}: </span>{sandboxNote}</p>
          {r.tests.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{t("val.tests")}</h3>
              <ul className="space-y-1 text-xs">
                {r.tests.map((x) => (
                  <li key={x.name}>
                    <Badge status={x.status} /> <span className="font-mono text-slate-300">{x.name}</span>
                    {x.detail && <pre className="mt-1 overflow-x-auto rounded-lg bg-rose-500/10 p-2 text-rose-100">{x.detail}</pre>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.evals && r.evals.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{t("val.evals")}</h3>
              <ul className="space-y-2 text-xs">
                {r.evals.map((e) => (
                  <li key={e.name} className="rounded-xl border border-white/8 p-3">
                    <div className="flex items-center gap-2">
                      <Badge status={e.status} /><span className="font-mono text-slate-200">{e.name}</span>
                      {e.holdout && <span className="rounded-full bg-violet-brand/15 px-2 py-0.5 text-violet-200">{t("val.holdout")}</span>}
                    </div>
                    {e.reasons.length > 0 && <div className="mt-1 text-rose-200">{e.reasons.join("; ")}</div>}
                    {e.status === "fail" && (
                      <div className="mt-1 space-y-0.5 font-mono text-slate-400">
                        <div>{t("val.expected")}: {short(e.expected)}</div>
                        <div>{t("val.actual")}: {short(e.actual)}</div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer">{t("val.check")} ({r.static.checks.length})</summary>
            <table className="mt-2 w-full text-left">
              <thead className="text-slate-500"><tr><th className="py-1">{t("val.check")}</th><th>{t("val.result")}</th><th>{t("val.details")}</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {r.static.checks.map((c) => (
                  <tr key={c.id}><td className="py-1 pr-2 font-mono">{c.id}</td><td className="pr-2"><Badge status={c.status} /></td><td>{c.message}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}

function Export({ v }: { v: VersionDetail }) {
  const t = useT();
  const targets = useQuery({ queryKey: ["integrations"], queryFn: () => api<Integration[]>("/studio/integrations") });
  const [target, setTarget] = useState("claude-code");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const exportable = v.status === "validated" || v.status === "verified";
  const info = useQuery({
    queryKey: ["install", v.id, target],
    queryFn: () => api<InstallInfo>(`/studio/versions/${v.id}/install/${target}`),
    enabled: exportable,
  });
  if (!exportable) return <ErrorBox error={t("export.blocked")} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="target" className="text-sm text-slate-400">{t("export.target")}</label>
        <select id="target" className="rounded-lg border border-white/10 bg-ink-950 px-2 py-1.5 text-sm text-slate-100" value={target}
          onChange={(e) => { setTarget(e.target.value); setConfirmReplace(false); }}>
          {targets.data?.filter((x) => x.id === "canonical" || v.manifest.compatibility.includes(x.id)).map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <a className={`ml-auto ${primaryBtn}`} href={`${API}/studio/versions/${v.id}/export/${target}`} download={info.data?.zip}>
          {t("export.download")}
        </a>
      </div>
      {info.error && <ErrorBox error={info.error} />}
      {info.data && (
        <>
          <p className="text-sm text-slate-300">{info.data.target.notes}</p>
          <p className="text-xs text-slate-400">{t("export.steps", { zip: info.data.zip })}</p>
          <CopyBlock label={t("export.installBash")} text={info.data.install.bash} />
          <CopyBlock label={t("export.installPs")} text={info.data.install.powershell} />
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
            {t("export.showReplace")}
          </label>
          {confirmReplace && (
            <>
              <p className="rounded-lg bg-amber-400/10 p-2 text-xs text-amber-200">{info.data.replace.warning}</p>
              <CopyBlock label={t("export.replaceBash")} text={info.data.replace.bash} />
              <CopyBlock label={t("export.replacePs")} text={info.data.replace.powershell} />
            </>
          )}
          <p className="text-xs italic text-slate-500">{info.data.note}</p>
        </>
      )}
    </div>
  );
}
