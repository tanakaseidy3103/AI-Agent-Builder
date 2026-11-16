/**
 * Details of one Skill Flow step: what it is, where it comes from (file + lines), the code, the facts, the real results
 * and the evidence for each connection. Links open the file at those lines in the Code Workspace.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { VersionDetail } from "../../api";
import { useT, type Key } from "../../i18n";
import { href } from "../../route";
import { fileQuery } from "../hooks";
import { CodeI, FileI } from "../icons";
import { Code, ErrorNote, Pill, StepMark, sectionTitle } from "../kit";
import { KIND_ICON, SOURCE_STYLE, STATE_TONE, nodeLabel } from "./FlowNodeCard";
import type { Fact, FileRef, Flow, FlowNode, ResultItem } from "./types";

type T = ReturnType<typeof useT>;

const VALUES = new Set(["api_run", "api_run_and_evaluation", "none", "text"]);
const factValue = (t: T, f: Fact) => (f.key === "not_in_zip" ? t("sf.val.not_in_zip") : VALUES.has(f.value) ? t(`sf.val.${f.value}` as Key) : f.value);
const linesLabel = (t: T, r: FileRef) => (!r.start ? "" : r.end && r.end !== r.start ? t("sf.lines", { a: r.start, b: r.end }) : t("sf.line", { n: r.start }));
const short = (x: unknown) => { const s = JSON.stringify(x, null, 2) ?? ""; return s.length > 1200 ? `${s.slice(0, 1200)}…` : s; };

/** "Open in Code Workspace" for a file (and lines). A plain link: works with the keyboard, middle-click and back. */
function OpenLink({ v, r }: { v: VersionDetail; r: FileRef }) {
  const t = useT();
  return (
    <a href={href("code", v.id, "files", r)} data-testid="sf-open"
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-xs font-medium text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <CodeI size={13} />{t("sf.open")}
    </a>
  );
}

function RefButton({ r, active, onShow }: { r: FileRef; active: boolean; onShow: (r: FileRef) => void }) {
  const t = useT();
  return (
    <button type="button" onClick={() => onShow(r)} aria-pressed={active}
      className={`inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${active ? "bg-accent/12 text-accent-ink" : "text-mute hover:bg-hover hover:text-ink"}`}>
      <FileI size={11} className="shrink-0" /><span className="truncate">{r.path}</span>{r.start ? <span className="shrink-0">· {linesLabel(t, r)}</span> : null}
    </button>
  );
}

function Excerpt({ v, r }: { v: VersionDetail; r: FileRef }) {
  const t = useT();
  const exists = v.files.some((f) => f.path === r.path);
  // retryOnMount off: a file that failed must not be re-requested every time this panel mounts (that would put the
  // shared query back to "pending" and the flow back to its loading state, in a loop). "Try again" retries it.
  const q = useQuery({ ...fileQuery(v.id, r.path), enabled: exists, retryOnMount: false });
  if (!exists) return <p className="text-xs text-mute">{t("sf.state.missing")}: <span className="font-mono">{r.path}</span></p>;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-line bg-canvas py-1.5" data-testid="sf-code">
      <Code label={`${t("sf.code")}: ${r.path}`} text={q.data ?? t("skills.loading")} lineNumbers path={r.path}
        focus={q.data && r.start ? { start: r.start, end: r.end } : undefined} />
    </div>
  );
}

function Result({ r, onShow, shown }: { r: ResultItem; onShow: (r: FileRef) => void; shown?: FileRef }) {
  const t = useT();
  const status = r.status === "not_executed" ? "pending" : r.status;
  return (
    <li className="space-y-1 py-1.5" data-result={r.name} data-status={r.status}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StepMark status={status} />
        <span className="min-w-0 break-all font-mono text-[12px] text-ink">{r.name}</span>
        {r.status === "not_executed" && <Pill>{t("sf.state.not_executed")}</Pill>}
        {r.holdout && <Pill tone="info">{t("sf.holdout")}</Pill>}
        {r.unmatched && <Pill tone="warn">{t("sf.unmatched")}</Pill>}
        <span className={`text-[11px] ${SOURCE_STYLE[r.source]}`}>{t(`sf.source.${r.source}` as Key)}</span>
        {r.ref && <RefButton r={r.ref} active={shown?.path === r.ref.path && shown?.start === r.ref.start} onShow={onShow} />}
      </div>
      {r.detail && <p className="whitespace-pre-wrap break-words pl-7 text-[12px] text-mute">{r.detail.length > 600 ? `${r.detail.slice(0, 600)}…` : r.detail}</p>}
      {(r.input !== undefined || r.expected !== undefined || r.actual !== undefined) && (
        <details className="pl-7 text-[12px]">
          <summary className="cursor-pointer select-none text-mute hover:text-ink">{[r.input !== undefined && t("sf.input"), r.expected != null && t("sf.expected"), r.actual !== undefined && t("sf.actual")].filter(Boolean).join(" · ")}</summary>
          {([["sf.input", r.input], ["sf.expected", r.expected], ["sf.actual", r.actual]] as [Key, unknown][]).filter(([, x]) => x !== undefined && x !== null).map(([k, x]) => (
            <div key={k} className="mt-1"><p className="text-[11px] text-faint">{t(k)}</p><pre className="max-h-40 overflow-auto rounded bg-canvas p-2 font-mono text-[11.5px] text-ink/90">{short(x)}</pre></div>
          ))}
        </details>
      )}
    </li>
  );
}

export function NodeDetail({ v, flow, node, onSelect }: { v: VersionDetail; flow: Flow; node: FlowNode; onSelect: (id: string) => void }) {
  const t = useT();
  const Icon = KIND_ICON[node.kind];
  const first = node.refs[0]; // derive puts the most relevant place first (e.g. the entrypoint file, then its manifest line)
  const [shown, setShown] = useState<FileRef | undefined>(first);
  const ref = shown ?? first;
  const nodeById = (id: string) => flow.nodes.find((n) => n.id === id);
  const links = flow.edges.filter((e) => e.from === node.id || e.to === node.id);
  const facts = node.facts;
  return (
    <section id="sf-detail" aria-label={t("sf.detail")} data-testid="sf-detail" data-node={node.id} className="min-w-0 space-y-4">
      <header className="space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Icon size={15} className="shrink-0 text-mute" />
          <h3 className="text-sm font-semibold text-ink">{t(`sf.kind.${node.kind}` as Key)}</h3>
          <Pill tone={STATE_TONE[node.state]}>{t(`sf.state.${node.state}` as Key)}</Pill>
          <span className={`text-[11.5px] ${SOURCE_STYLE[node.source]}`} title={t(`sf.sourceHelp.${node.source}` as Key)}>{t(`sf.source.${node.source}` as Key)}</span>
        </div>
        {node.title && <p className="break-all font-mono text-[12.5px] text-ink/90">{node.title}</p>}
        <p className="text-[12.5px] leading-relaxed text-mute">{t(`sf.explain.${node.kind}` as Key)}</p>
        <p className="text-[11.5px] text-faint">{t(`sf.sourceHelp.${node.source}` as Key)}</p>
      </header>

      <section aria-label={t("sf.code")} className="space-y-2">
        <h4 className={sectionTitle}>{t("sf.code")}</h4>
        {node.refs.length === 0 && !ref ? <p className="text-xs text-mute">{t("sf.noRefs")}</p> : (
          <>
            <div className="flex flex-wrap items-center gap-1">
              {node.refs.map((r) => <RefButton key={`${r.path}:${r.start ?? ""}`} r={r} active={ref?.path === r.path && ref?.start === r.start} onShow={setShown} />)}
              {ref && !node.refs.some((r) => r.path === ref.path && r.start === ref.start) && <RefButton r={ref} active onShow={setShown} />}
            </div>
            {ref && (
              <>
                <Excerpt v={v} r={ref} />
                {v.files.some((f) => f.path === ref.path) && <OpenLink v={v} r={ref} />}
              </>
            )}
          </>
        )}
      </section>

      {facts.length > 0 && (
        <section aria-label={t("sf.facts")} className="space-y-1.5">
          <h4 className={sectionTitle}>{t("sf.facts")}</h4>
          <dl className="divide-y divide-line rounded-md border border-line">
            {facts.map((f, i) => (
              <div key={`${f.key}:${i}`} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2.5 py-1.5 text-[12px]" data-fact={f.key}>
                <dt className="w-36 shrink-0 text-mute">{t(`sf.fact.${f.key}` as Key)}</dt>
                <dd className="min-w-0 flex-1 break-words text-ink/90">
                  <span className={f.key === "import" || f.key === "property" || f.key === "params" || f.key === "entrypoint" ? "font-mono" : ""}>{factValue(t, f)}</span>
                  {f.detail && <span className="ml-1.5 font-mono text-mute">{f.detail}</span>}
                  {f.required && <span className="ml-1.5"><Pill tone="info">{t("sf.required")}</Pill></span>}
                </dd>
                <span className={`text-[11px] ${SOURCE_STYLE[f.source]}`}>{t(`sf.source.${f.source}` as Key)}</span>
                {f.ref?.start && <RefButton r={f.ref} active={ref?.path === f.ref.path && ref?.start === f.ref.start} onShow={setShown} />}
              </div>
            ))}
          </dl>
        </section>
      )}

      {node.results.length > 0 && (
        <section aria-label={t("sf.results")} className="space-y-1">
          <h4 className={sectionTitle}>{t("sf.results")}</h4>
          <ul className="divide-y divide-line">{node.results.map((r, i) => <Result key={`${r.name}:${i}`} r={r} onShow={setShown} shown={ref} />)}</ul>
        </section>
      )}

      <section aria-label={t("sf.connections")} className="space-y-1.5">
        <h4 className={sectionTitle}>{t("sf.connections")}</h4>
        {links.length === 0 ? <p className="text-xs text-mute">{t("sf.noEvidence")}</p> : (
          <ul className="space-y-1.5">
            {links.map((e, i) => {
              const out = e.from === node.id;
              const other = nodeById(out ? e.to : e.from);
              return (
                <li key={i} className="space-y-0.5 text-[12px]" data-edge={`${e.from}>${e.to}`}>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                    <span className="text-faint">{out ? "→" : "←"}</span>
                    {other && (
                      <button type="button" onClick={() => onSelect(other.id)}
                        className="rounded px-1 font-medium text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        {nodeLabel(t, other)}</button>
                    )}
                    <span className="text-mute">· {t(`sf.reason.${e.reason}` as Key)}</span>
                    <span className={`text-[11px] ${SOURCE_STYLE[e.source]}`}>· {t(`sf.source.${e.source}` as Key)}</span>
                    <RefButton r={e.evidence} active={ref?.path === e.evidence.path && ref?.start === e.evidence.start} onShow={setShown} />
                  </div>
                  {e.evidence.text && <code className="block truncate pl-4 font-mono text-[11.5px] text-mute" title={e.evidence.text}>{e.evidence.text}</code>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
