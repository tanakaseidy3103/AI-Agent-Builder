/** Agent Office: the real pipeline, grouped by the five roles that perform it. Data = job stages + persisted events. */
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, type AgentEvent, type AgentId, type Job, type Stage } from "../api";
import { useT, type Key } from "../i18n";
import { Activity, Check, Cube, Flask, Shield, Spark, Wrench } from "./icons";
import { Pill, StepMark, toneOf } from "./kit";

export const ROLES: { id: AgentId; stages: string[]; icon: typeof Spark }[] = [
  { id: "architect", stages: ["analyze", "specify", "plan"], icon: Spark },
  { id: "coder", stages: ["generate_files"], icon: Wrench },
  { id: "reviewer", stages: ["static_validation", "report"], icon: Shield },
  { id: "tester", stages: ["test_generation", "sandbox_tests", "evaluate"], icon: Flask },
  { id: "packager", stages: ["package"], icon: Cube },
];

type RoleState = "pending" | "running" | "passed" | "failed";

function roleState(stages: Stage[]): RoleState {
  if (stages.some((s) => s.status === "running")) return "running";
  if (stages.some((s) => s.status === "failed")) return "failed";
  if (stages.length > 0 && stages.every((s) => s.status === "passed" || s.status === "skipped")) return "passed";
  return "pending";
}

export function useRunEvents(job?: Job) {
  const live = job?.status === "draft" || job?.status === "generating";
  const q = useQuery({
    queryKey: ["events", job?.id],
    queryFn: () => api<AgentEvent[]>(`/studio/events?run_id=${job!.id}&limit=500`),
    enabled: !!job?.id,
    refetchInterval: live ? 1000 : false,
  });
  // one last fetch once the job settles so the final events are not missed
  useEffect(() => { if (job?.id && !live) q.refetch(); }, [live, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return q.data ?? [];
}

/** Product-level steps, each computed from real stage data. */
function flowSteps(job: Job, repairs: number, exportable: boolean | null) {
  const st = (n: string) => job.stages.find((s) => s.name === n)?.status ?? "pending";
  const all = (...ns: string[]) => {
    const xs = ns.map(st);
    if (xs.includes("running")) return "running";
    if (xs.includes("failed")) return "failed";
    return xs.every((x) => x === "passed" || x === "skipped") ? "passed" : "pending";
  };
  return [
    ["flow.describe", "passed"],
    ["flow.plan", all("analyze", "specify", "plan")],
    ["flow.generate", st("generate_files") === "running" && repairs === 0 ? "running" : all("generate_files", "test_generation")],
    ["flow.review", st("static_validation")],
    ["flow.test", all("sandbox_tests", "evaluate")],
    ["flow.repair", repairs > 0 ? "passed" : job.status === "completed" || job.status === "failed" ? "skipped" : "pending"],
    ["flow.validate", st("report")],
    ["flow.export", exportable === null ? "pending" : exportable ? "passed" : "failed"],
  ] as [Key, string][];
}

export function Pipeline({ job, exportable }: { job: Job; exportable: boolean | null }) {
  const t = useT();
  const events = useRunEvents(job);
  const repairs = events.filter((e) => e.agent_id === "coder" && /started \(repair \d+\)/.test(e.message ?? "")).length;
  const byRole = ROLES.map((r) => ({ ...r, list: job.stages.filter((s) => r.stages.includes(s.name)) }));
  const current = byRole.find((r) => roleState(r.list) === "running");
  const lastEvent = current ? [...events].reverse().find((e) => e.agent_id === current.id) : undefined;
  const steps = flowSteps(job, repairs, exportable);

  return (
    <section aria-label={t("office.title")} className="rounded-lg border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-mute" />
          <h2 className="text-[13px] font-semibold text-ink">{t("office.title")}</h2>
          <Pill tone={toneOf(job.status)}>{job.status}</Pill>
        </div>
        <span className="font-mono text-[11px] text-faint">{job.provider ?? "—"}</span>
      </header>

      <ol aria-label={t("flow.title")} className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-line px-4 py-2.5 text-[11.5px]">
        {steps.map(([k, s], i) => (
          <li key={k} data-flow={k.split(".")[1]} data-state={s} className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${s === "running" ? "bg-accent/12 text-accent-ink" : s === "passed" ? "text-ink" : s === "failed" ? "text-bad" : "text-faint"}`}>
              {s === "passed" && <Check size={11} className="text-ok" />}{t(k)}
            </span>
            {i < steps.length - 1 && <span aria-hidden="true" className="text-faint">›</span>}
          </li>
        ))}
      </ol>

      <div className="px-4 py-3" aria-live="polite">
        {current ? (
          <p className="text-sm text-ink"><span className="text-mute">{t("office.now")} · </span>
            <span className="font-medium">{t(`role.${current.id}` as Key)}</span>
            <span className="text-mute"> — {lastEvent?.message ?? current.list.find((s) => s.status === "running")?.name}</span></p>
        ) : (
          <p className="text-sm text-mute">{job.status === "completed" || job.status === "failed" ? t("office.finished") : t("office.queued")}</p>
        )}
      </div>

      <ol className="grid gap-px overflow-hidden border-t border-line bg-line sm:grid-cols-5" aria-label={t("office.roles")}>
        {byRole.map((r) => {
          const state = roleState(r.list);
          const Icon = r.icon;
          const done = r.list.filter((s) => s.status === "passed").length;
          return (
            <li key={r.id} data-testid={`role-${r.id}`} data-state={state} className={`bg-panel px-3 py-3 ${state === "running" ? "bg-accent/[0.04]" : ""}`}>
              <div className="flex items-center gap-2">
                <span className={`grid h-6 w-6 place-items-center rounded-md border ${state === "running" ? "border-accent/40 text-accent-ink" : state === "failed" ? "border-bad/40 text-bad" : state === "passed" ? "border-ok/30 text-ok" : "border-line text-faint"}`}>
                  <Icon size={13} />
                </span>
                <span className="text-[13px] font-medium text-ink">{t(`role.${r.id}` as Key)}</span>
                <span className="ml-auto text-[11px] tabular-nums text-faint">{done}/{r.list.length}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-mute">{t(`role.${r.id}.does` as Key)}</p>
              <ul className="mt-2 space-y-1">
                {r.list.map((s) => (
                  <li key={s.name} className="flex items-center gap-1.5 text-[11.5px]" title={s.detail}>
                    <StepMark status={s.status} />
                    <span className={`font-mono ${s.status === "pending" ? "text-faint" : "text-ink/85"}`}>{s.name}</span>
                    {s.duration_ms ? <span className="ml-auto tabular-nums text-faint">{(s.duration_ms / 1000).toFixed(1)}s</span> : null}
                  </li>
                ))}
              </ul>
              {r.id === "coder" && repairs > 0 && <p className="mt-2 text-[11px] text-warn">{t("office.repairs", { n: repairs })}</p>}
            </li>
          );
        })}
      </ol>
      <p className="border-t border-line px-4 py-2 text-[11px] text-faint">{t("office.planned")}: {t("role.researcher")}, {t("role.security")}</p>

      <details className="border-t border-line">
        <summary className="cursor-pointer select-none px-4 py-2 text-[12px] text-mute hover:text-ink">{t("office.activity")} ({events.length})</summary>
        {events.length === 0 ? <p className="px-4 pb-3 text-xs text-faint">{t("office.noActivity")}</p> : (
          <ol aria-label={t("office.activity")} className="max-h-64 space-y-1 overflow-y-auto px-4 pb-3 font-mono text-[11.5px]">
            {[...events].reverse().slice(0, 60).map((e) => (
              <li key={e.id} className="flex gap-2">
                <time className="shrink-0 tabular-nums text-faint" dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time>
                <span className="w-20 shrink-0 truncate text-mute">{t(`role.${e.agent_id}` as Key)}</span>
                <span className={e.state === "failed" ? "text-bad" : "text-ink/85"}>{e.message}</span>
              </li>
            ))}
          </ol>
        )}
      </details>
      <p className="sr-only">{t("office.subtitle")}</p>
    </section>
  );
}
