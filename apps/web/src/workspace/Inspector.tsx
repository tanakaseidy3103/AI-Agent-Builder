/** Right panel: the generated Skill. Every value comes from GET /studio/versions/{id} and its stored report. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { API, api, type InstallInfo, type Integration, type Report, type VersionDetail } from "../api";
import { useT, type Key } from "../i18n";
import { Alert, Check, Cube, Download, FileI, Folder } from "./icons";
import { Button, Code, CopyButton, CopyField, Empty, ErrorNote, Pill, StatusPill, StepMark, Tabs, sectionTitle } from "./kit";
import { ProjectInstall } from "./ProjectInstall";

type Tab = (typeof TABS)[number];

export const TABS = ["files", "manifest", "tests", "validation", "repairs", "export"] as const;

export function Inspector({ id, onSelect, tab: initialTab }: { id: string | null; onSelect: (id: string) => void; tab?: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["version", id], queryFn: () => api<VersionDetail>(`/studio/versions/${id}`), enabled: !!id });
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initialTab ?? "") ? (initialTab as Tab) : "files");
  if (!id) return <Empty icon={<Cube size={16} />} title={t("insp.emptyTitle")} body={t("insp.emptyBody")} />;
  if (q.isPending) return <p className="p-4 text-sm text-mute">{t("skills.loading")}</p>;
  if (q.error) return <div className="p-4"><ErrorNote error={q.error} /></div>;
  const v = q.data;
  const r = v.validation?.report;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-2.5 border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">{v.manifest.name}</h2>
            <p className="truncate font-mono text-[11.5px] text-mute">{v.slug}@{v.version} · {v.kind}</p>
          </div>
          <select aria-label={t("version")} value={id} onChange={(e) => onSelect(e.target.value)}
            className="h-7 rounded-md border border-line bg-raised px-1.5 text-xs text-ink focus:border-accent/60 focus:outline-none">
            {v.versions.map((x) => <option key={x.id} value={x.id}>v{x.version} · {t(`st.${x.status}` as Key)}</option>)}
          </select>
        </div>
        <EvidenceLadder v={v} />
        <p className="text-xs leading-relaxed text-mute"><StatusPill status={v.status} /> <span className="ml-1">{t(`status.${v.status}` as Key)}</span></p>
      </header>
      <Tabs label={t("insp.tabs")} value={tab} onChange={setTab} items={[
        { id: "files", label: t("tab.files"), count: v.files.length },
        { id: "manifest", label: t("tab.manifest") },
        { id: "tests", label: t("insp.tests"), count: r ? r.tests.length + (r.evals?.length ?? 0) : 0 },
        { id: "validation", label: t("tab.validation") },
        { id: "repairs", label: t("insp.repairs"), count: r?.repair_rounds ?? 0 },
        { id: "export", label: t("tab.export") },
      ]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "files" && <Files v={v} />}
        {tab === "manifest" && <Manifest v={v} />}
        {tab === "tests" && <Tests r={r} />}
        {tab === "validation" && <Validation v={v} />}
        {tab === "repairs" && <Repairs r={r} />}
        {tab === "export" && <Export v={v} />}
      </div>
    </div>
  );
}

/** generated → statically validated → tested → verified, derived only from the stored report. */
export function EvidenceLadder({ v }: { v: VersionDetail }) {
  const t = useT();
  const r = v.validation?.report;
  const steps: [Key, boolean][] = [
    ["ev.generated", true],
    ["ev.validated", v.status !== "validation_failed"],
    ["ev.tested", r?.sandbox.status === "ran"],
    ["ev.verified", v.status === "verified"],
  ];
  return (
    <ol aria-label={t("ev.title")} className="flex flex-wrap items-center gap-1 text-[11px]">
      {steps.map(([k, ok], i) => (
        <li key={k} data-reached={ok} className="flex items-center gap-1">
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ring-1 ring-inset ${ok ? "bg-ok/10 text-ok ring-ok/25" : "text-faint ring-line"}`}>
            {ok ? <Check size={11} /> : <span aria-hidden="true">○</span>}{t(k)}
          </span>
          {i < steps.length - 1 && <span aria-hidden="true" className="text-faint">›</span>}
        </li>
      ))}
    </ol>
  );
}

function Files({ v }: { v: VersionDetail }) {
  const t = useT();
  const [path, setPath] = useState(v.files.find((f) => f.path === "scripts/main.py")?.path ?? "SKILL.md");
  const fileQuery = (p: string) => ({ queryKey: ["file", v.id, p], queryFn: () => api<string>(`/studio/versions/${v.id}/files/${p}`) });
  const q = useQuery(fileQuery(path));
  const qc = useQueryClient();
  const copyable = v.status !== "validation_failed"; // same rule as export: a failed Skill is never handed out
  // failed static checks about this file (check ids are "<check>:<path>"), and the lines they name
  const fileChecks = (v.validation?.report.static.checks ?? []).filter((c) => c.status === "fail" && c.id.endsWith(`:${path}`));
  const marks = new Set(fileChecks.flatMap((c) => [...c.message.matchAll(/\bline (\d+)/g)].map((m) => Number(m[1]))));
  // every file with its destination inside the tool's Skills folder; fetched only on click, cached afterwards
  const copyAll = async () => (await Promise.all(v.files.map(async (f) => `# ${v.slug}/${f.path}\n${await qc.fetchQuery(fileQuery(f.path))}`))).join("\n\n");
  const tree = useMemo(() => {
    const groups = new Map<string, typeof v.files>();
    for (const f of v.files) {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
      groups.set(dir, [...(groups.get(dir) ?? []), f]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  }, [v]);
  return (
    <div className="flex min-h-0 flex-col lg:flex-row">
      <div className="shrink-0 border-b border-line px-3 py-2 lg:hidden">
        <label htmlFor="file-pick" className="sr-only">{t("files.label")}</label>
        <select id="file-pick" value={path} onChange={(e) => setPath(e.target.value)}
          className="h-8 w-full rounded-md border border-line bg-raised px-2 font-mono text-[12.5px] text-ink focus:border-accent/60 focus:outline-none">
          {v.files.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
        </select>
      </div>
      <nav aria-label={t("files.label")} className="hidden shrink-0 py-2 lg:block lg:w-48 lg:border-r lg:border-line">
        {tree.map(([dir, files]) => (
          <div key={dir || "root"}>
            {dir && <p className="flex items-center gap-1.5 px-3 pb-0.5 pt-1.5 text-[11.5px] text-mute"><Folder size={12} />{dir}</p>}
            {files.map((f) => {
              const name = f.path.split("/").pop();
              return (
                <button key={f.path} type="button" onClick={() => setPath(f.path)} aria-current={path === f.path}
                  className={`flex w-full items-center gap-1.5 py-1 pr-3 text-left font-mono text-[12px] ${dir ? "pl-6" : "pl-3"} ${path === f.path ? "bg-accent/10 text-ink" : "text-mute hover:bg-hover hover:text-ink"}`}>
                  <FileI size={12} className="shrink-0" /><span className="truncate">{name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 border-b border-line px-3 py-1.5 text-[11.5px] text-mute">
          <span className="truncate font-mono" title={t("files.destHelp")}>{v.slug}/{path}</span>
          <span className="font-mono">{v.files.find((f) => f.path === path)?.size ?? 0} B</span>
          <span className="ml-auto flex gap-1">
            <CopyButton label={t("files.copy")} getText={() => q.data ?? ""} disabled={!copyable || !q.data} title={copyable ? undefined : t("export.blocked")} />
            <CopyButton label={t("files.copyAll")} getText={copyAll} disabled={!copyable} title={copyable ? undefined : t("export.blocked")} />
          </span>
        </div>
        <div className="max-h-[60vh] overflow-auto bg-canvas px-1 py-2">
          {fileChecks.length > 0 && (
            <ul className="mx-2 mb-2 space-y-1.5 rounded-md border border-bad/25 bg-bad/[0.06] px-3 py-2 font-sans text-[12.5px]" aria-label={t("files.checks")}>
              {fileChecks.map((c) => (
                <li key={c.id}>
                  <span className="font-mono text-bad">{c.id.split(":")[0]}</span> <span className="text-ink/90">{c.message}</span>
                  {c.hint && <span className="block text-mute">{t("val.howToFix")}: {c.hint}</span>}
                </li>
              ))}
            </ul>
          )}
          {q.error ? <ErrorNote error={q.error} /> : <Code label={t("files.preview")} text={q.data ?? t("skills.loading")} lineNumbers path={path} marks={marks} />}
        </div>
      </div>
    </div>
  );
}

function Manifest({ v }: { v: VersionDetail }) {
  const t = useT();
  const m = v.manifest;
  const rows: [Key, string[]][] = [
    ["manifest.kind", [m.kind]], ["manifest.permissions", m.permissions], ["manifest.dependencies", m.dependencies],
    ["manifest.tools", m.tools], ["manifest.compat", m.compatibility],
    ...(m.execution ? [["manifest.exec", [m.execution.entrypoint, `${m.execution.timeout_seconds}s`, `${m.execution.memory_mb} MB`]] as [Key, string[]]] : []),
  ];
  return (
    <div className="space-y-4 p-4">
      <dl className="divide-y divide-line rounded-md border border-line text-[13px]">
        {rows.map(([k, val]) => (
          <div key={k} className="flex gap-3 px-3 py-1.5">
            <dt className="w-32 shrink-0 text-mute">{t(k)}</dt>
            <dd className="min-w-0 break-words font-mono text-[12px] text-ink">{val.length ? val.join(", ") : <span className="font-sans text-faint">{t("manifest.none")}</span>}</dd>
          </div>
        ))}
      </dl>
      <CopyField label={t("manifest.input")} text={JSON.stringify(m.input_schema, null, 2)} />
      <CopyField label={t("manifest.output")} text={JSON.stringify(m.output_schema, null, 2)} />
    </div>
  );
}

function short(value: unknown) {
  const s = JSON.stringify(value);
  return s && s.length > 200 ? `${s.slice(0, 200)}…` : s ?? "null";
}

function Tests({ r }: { r?: Report }) {
  const t = useT();
  if (!r) return <Empty title={t("val.none")} />;
  return (
    <div className="space-y-5 p-4">
      <section>
        <h3 className={`${sectionTitle} mb-2`}>{t("val.tests")} · {r.tests.filter((x) => x.status === "pass").length}/{r.tests.length}</h3>
        {r.tests.length === 0 ? <p className="text-xs text-mute">{t("insp.notRun")}</p> : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {r.tests.map((x) => (
              <li key={x.name} className="px-3 py-2 text-xs">
                <div className="flex items-center gap-2"><StepMark status={x.status} /><span className="truncate font-mono text-ink/90">{x.name}</span></div>
                {x.detail && <pre className="mt-1.5 max-h-40 overflow-auto rounded bg-bad/8 p-2 font-mono text-[11px] text-ink/80">{x.detail}</pre>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className={`${sectionTitle} mb-2`}>{t("val.evals")} · {(r.evals ?? []).filter((x) => x.status === "pass").length}/{r.evals?.length ?? 0}</h3>
        {!r.evals?.length ? <p className="text-xs text-mute">{t("insp.notRun")}</p> : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {r.evals.map((e) => (
              <li key={e.name} className="px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <StepMark status={e.status} /><span className="font-mono text-ink/90">{e.name}</span>
                  {e.holdout && <Pill tone="accent">{t("val.holdout")}</Pill>}
                </div>
                {e.reasons.length > 0 && <p className="mt-1 text-bad">{e.reasons.join("; ")}</p>}
                {e.status === "fail" && (
                  <div className="mt-1 space-y-0.5 font-mono text-[11px] text-mute">
                    <div><span className="text-faint">{t("val.expected")} </span>{short(e.expected)}</div>
                    <div><span className="text-faint">{t("val.actual")} </span>{short(e.actual)}</div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
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
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? t("val.running") : t("val.run")}</Button>
        {r && <span className="text-[11px] text-mute">{t("val.summary", { passed: r.static.passed, failed: r.static.failed, warnings: r.static.warnings, ms: r.duration_ms })}</span>}
      </div>
      {m.error && <ErrorNote error={m.error} />}
      {!r ? <p className="text-sm text-mute">{t("val.none")}</p> : (
        <>
          {r.failure_category && r.failure_category !== "none" && (
            <div role="status" className="flex gap-2 rounded-md border border-warn/25 bg-warn/8 px-3 py-2 text-[13px] text-ink">
              <Alert size={14} className="mt-0.5 shrink-0 text-warn" />{t(`cat.${r.failure_category}` as Key)}
            </div>
          )}
          {failed.length > 0 && (
            <ul className="space-y-2" aria-label={t("val.howToFix")}>
              {failed.map((c) => (
                <li key={c.id} className="rounded-md border border-line bg-raised px-3 py-2 text-xs">
                  <div className="font-mono text-bad">{c.id}</div>
                  <div className="mt-1 text-ink/85">{c.message}</div>
                  {c.hint && <div className="mt-1.5 text-mute"><span className="font-medium text-warn">{t("val.howToFix")}: </span>{c.hint}</div>}
                </li>
              ))}
            </ul>
          )}
          {r.criteria && (
            <section>
              <h3 className={`${sectionTitle} mb-2`}>{t("val.criteria")}</h3>
              <ul className="divide-y divide-line rounded-md border border-line">
                {r.criteria.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <StepMark status={c.passed ? "pass" : "fail"} /><span className="w-24 font-mono text-ink/90">{c.id}</span>
                    <span className="min-w-0 flex-1 truncate text-mute">{c.detail}</span>
                    <Pill tone={c.passed ? "ok" : "bad"}>{c.passed ? "pass" : "fail"}</Pill>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-xs text-mute"><span className="font-medium text-ink">{t("val.sandbox")}: </span>{sandboxNote}</p>
          {r?.llm && (
            <p className="text-xs text-mute" data-testid="llm-usage"><span className="font-medium text-ink">{t("val.model")}: </span>
              {t("val.llm", { calls: r.llm.calls, pin: r.llm.prompt_tokens, out: r.llm.output_tokens, s: r.llm.model_seconds, tps: r.llm.tokens_per_second ?? "—" })}</p>
          )}
          <details className="text-xs text-mute">
            <summary className="cursor-pointer select-none hover:text-ink">{t("val.check")} ({r.static.checks.length})</summary>
            <ul className="mt-2 divide-y divide-line rounded-md border border-line">
              {r.static.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2 px-3 py-1.5">
                  <StepMark status={c.status} /><span className="w-44 shrink-0 truncate font-mono text-ink/85">{c.id}</span><span>{c.message}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

interface RepairRound { round: number; status: string; tests: string; evals: string; failing?: string[]; stopped?: string }

function Repairs({ r }: { r?: Report }) {
  const t = useT();
  const history = ((r as unknown as { repair_history?: RepairRound[] })?.repair_history ?? []);
  if (!r || history.length === 0) return <Empty title={t("insp.noRepairs")} body={t("insp.noRepairsBody")} />;
  return (
    <ol className="space-y-2 p-4" aria-label={t("insp.repairs")}>
      {history.map((h) => (
        <li key={h.round} className="rounded-md border border-line bg-raised px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">{t("insp.round", { n: h.round })}</span>
            <StatusPill status={h.status} />
            <span className="text-mute">{t("val.tests")} {h.tests} · {t("val.evals")} {h.evals}</span>
          </div>
          {h.stopped && <p className="mt-1 text-warn">{h.stopped}</p>}
          {h.failing && h.failing.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-mute">{h.failing.slice(0, 6).map((f) => <li key={f} className="truncate">{f}</li>)}</ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function Export({ v }: { v: VersionDetail }) {
  const t = useT();
  const targets = useQuery({ queryKey: ["integrations"], queryFn: () => api<Integration[]>("/studio/integrations") });
  const [target, setTarget] = useState("claude-code");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const exportable = v.status === "validated" || v.status === "verified";
  const info = useQuery({ queryKey: ["install", v.id, target], queryFn: () => api<InstallInfo>(`/studio/versions/${v.id}/install/${target}`), enabled: exportable });
  if (!exportable) return <div className="p-4"><ErrorNote error={t("export.blocked")} /></div>;
  return (
    <div className="space-y-3 p-4">
      {v.status !== "verified" && <p className="rounded-md border border-warn/25 bg-warn/8 px-3 py-2 text-xs text-ink/90">{t("insp.exportNotVerified")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="target" className="text-xs text-mute">{t("export.target")}</label>
        <select id="target" value={target} onChange={(e) => { setTarget(e.target.value); setConfirmReplace(false); }}
          className="h-8 rounded-md border border-line bg-raised px-2 text-sm text-ink focus:border-accent/60 focus:outline-none">
          {targets.data?.filter((x) => x.id === "canonical" || v.manifest.compatibility.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <a href={`${API}/studio/versions/${v.id}/export/${target}`} download={info.data?.zip}
          className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90">
          <Download size={14} />{t("export.download")}
        </a>
      </div>
      {info.error && <ErrorNote error={info.error} />}
      {info.data && (
        <>
          <p className="text-xs text-mute">{info.data.target.notes}</p>
          <p className="text-xs text-mute">{t("export.steps", { zip: info.data.zip })}</p>
          <CopyField label={t("export.installBash")} text={info.data.install.bash} />
          <CopyField label={t("export.installPs")} text={info.data.install.powershell} />
          <label className="flex items-center gap-2 text-xs text-ink/90">
            <input type="checkbox" className="accent-[var(--color-accent)]" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
            {t("export.showReplace")}
          </label>
          {confirmReplace && (
            <>
              <p className="rounded-md bg-warn/8 px-3 py-2 text-xs text-warn">{info.data.replace.warning}</p>
              <CopyField label={t("export.replaceBash")} text={info.data.replace.bash} />
              <CopyField label={t("export.replacePs")} text={info.data.replace.powershell} />
            </>
          )}
          <p className="text-[11px] italic text-faint">{info.data.note}</p>
        </>
      )}

      <section aria-label={t("gh.title")} className="space-y-2 border-t border-line pt-4">
        <h3 className={sectionTitle}>{t("gh.title")}</h3>
        <p className="text-xs leading-relaxed text-mute">{t("gh.body", { zip: info.data?.zip ?? "" })}</p>
        <CopyField label="bash / PowerShell" text={`cd ${v.slug}\ngit init -b main\ngit add .\ngit commit -m "Add ${v.slug} ${v.version}"\ngh repo create ${v.slug} --private --source . --push`} />
      </section>

      <div className="border-t border-line pt-4"><ProjectInstall v={v} /></div>
    </div>
  );
}
