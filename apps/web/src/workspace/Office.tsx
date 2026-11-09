/** Agent Office: five roles of the real, sequential pipeline. Every state and motion comes from job stages + persisted events. */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties } from "react";
import { api, type AgentEvent, type AgentId, type Job } from "../api";
import { useT, type Key } from "../i18n";
import { Check, CodeI, Cross, Cube, Flask, Shield, Spark } from "./icons";
import { Pill, StatusPill, StepMark } from "./kit";
import { POLL_MS } from "./hooks";
import { ROLE_ORDER, agentViews, turns, type AgentState, type AgentView, type Step } from "./agents";

export const ROLE_ICON: Record<AgentId, typeof Spark> = { architect: Spark, coder: CodeI, reviewer: Shield, tester: Flask, packager: Cube };
const live = (job?: Job) => job?.status === "draft" || job?.status === "generating";

/** Persisted events of one run. Only the `owner` (the run's activity stream) polls; others read the shared cache. */
export function useRunEvents(job?: Job, owner = false) {
  const isLive = live(job);
  const q = useQuery({
    queryKey: ["events", job?.id],
    queryFn: () => api<AgentEvent[]>(`/studio/events?run_id=${job!.id}&limit=500`),
    enabled: !!job?.id,
    refetchInterval: owner && isLive ? POLL_MS : false,
  });
  // one last fetch once the job settles so the final events are not missed
  const settled = !!job?.id && !isLive;
  useEffect(() => { if (owner && settled) q.refetch(); }, [owner, settled, job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return q.data ?? [];
}

/** Wall-clock seconds since `iso`, ticking only while `active` (a stage is really running). */
export function useElapsed(iso: string | undefined, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [active]);
  return iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null;
}

export const fmtSecs = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

/** Human task name for a stage; repair rounds of generate_files read differently. */
export function taskOf(t: ReturnType<typeof useT>, stage: string | null | undefined, label?: string) {
  if (!stage) return "";
  if (stage === "generate_files" && label?.startsWith("repair")) return t("task.repair");
  return t(`task.${stage}` as Key);
}

const STATE_RING: Record<AgentState, string> = {
  working: "border-accent/70 text-accent-ink bg-accent/10",
  done: "border-ok/40 text-ok bg-ok/[0.06]",
  failed: "border-bad/50 text-bad bg-bad/[0.07]",
  waiting: "border-dashed border-line-strong text-faint bg-raised",
};

export function AgentBadge({ role, state, size = 44 }: { role: AgentId; state: AgentState; size?: number }) {
  const Icon = ROLE_ICON[role];
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {state === "working" && <span aria-hidden="true" className="agent-orbit absolute -inset-[3px] rounded-full" />}
      <span className={`relative grid h-full w-full place-items-center rounded-full border ${STATE_RING[state]}`}>
        <Icon size={Math.round(size * 0.4)} />
      </span>
      {state === "done" && <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-ok text-canvas ring-2 ring-panel"><Check size={10} /></span>}
      {state === "failed" && <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-bad text-canvas ring-2 ring-panel"><Cross size={9} /></span>}
    </span>
  );
}

function Bars() {
  return <span aria-hidden="true" className="agent-bars inline-flex h-2.5 items-end gap-[2px]"><i /><i /><i /></span>;
}

const STATE_TEXT: Record<AgentState, string> = { working: "text-accent-ink", done: "text-ok", failed: "text-bad", waiting: "text-faint" };
const center = (i: number) => `${(i + 0.5) * 20}%`;

/** The office floor: who is working, who is waiting, what is done, and the real handoffs between them. */
export function OfficeStage({ job, selected, onSelect, awaitingApproval = false }: {
  job?: Job; selected: AgentId | null; onSelect: (r: AgentId) => void; awaitingApproval?: boolean;
}) {
  const t = useT();
  const events = useRunEvents(job);
  const views = agentViews(job, events);
  const ts = turns(events);
  const working = views.find((v) => v.state === "working");
  const elapsed = useElapsed(working?.startedAt, !!working);
  const isLive = live(job);
  const repairs = views.find((v) => v.id === "coder")!.repairs;
  const lastRepair = [...ts].reverse().find((x) => x.repair);
  const prev = ts.at(-2), cur = ts.at(-1);
  const finalEvent = [...events].reverse().find((e) => e.state === "completed");

  return (
    <section aria-label={t("office.title")} className="border-b border-line bg-panel">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 sm:px-6">
        <h2 className="text-[13px] font-semibold text-ink">{t("office.title")}</h2>
        {awaitingApproval ? <Pill tone="warn">{t("plan.awaiting")}</Pill> : job ? <StatusPill status={job.status} /> : <Pill>{t("office.idle")}</Pill>}
        <span className="ml-auto truncate font-mono text-[11px] text-faint">{job?.provider ?? ""}</span>
      </header>

      <ol aria-label={t("office.roles")} className="relative mx-auto mt-3 grid max-w-3xl grid-cols-5 px-2 sm:px-4">
        {/* track between stations; a segment lights up once work has really passed through it */}
        {ROLE_ORDER.slice(0, -1).map((r, i) => (
          <span key={r} aria-hidden="true" className={`absolute top-[22px] h-px ${views[i].state !== "waiting" && views[i + 1].state !== "waiting" ? "bg-line-strong" : "bg-line"}`}
            style={{ left: `calc(${center(i)} + 26px)`, width: "calc(20% - 52px)" }} />
        ))}
        {isLive && prev && cur && prev.role !== cur.role && (
          <span key={ts.length} aria-hidden="true" className="handoff-comet absolute top-[20px] h-[5px] w-[5px] rounded-full bg-accent-ink"
            style={{ "--from": center(ROLE_ORDER.indexOf(prev.role)), "--to": center(ROLE_ORDER.indexOf(cur.role)) } as CSSProperties} />
        )}
        {views.map((v) => <Station key={v.id} v={v} selected={selected === v.id} onSelect={onSelect} elapsed={v === working ? elapsed : null} />)}
      </ol>

      {repairs > 0 && lastRepair?.reason && (
        <div className="relative mx-auto h-6 max-w-3xl px-2 sm:px-4" aria-hidden="true">
          <svg className="absolute inset-x-2 top-0 h-6 w-[calc(100%-1rem)] sm:inset-x-4 sm:w-[calc(100%-2rem)]" viewBox="0 0 100 24" preserveAspectRatio="none">
            <path d={`M${(ROLE_ORDER.indexOf(lastRepair.reason.role) + 0.5) * 20},2 C${(ROLE_ORDER.indexOf(lastRepair.reason.role) + 0.5) * 20},20 30,20 30,2`}
              fill="none" strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
              className={views[1].state === "working" ? "stroke-accent-ink" : "stroke-warn/60"} />
          </svg>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-3 pt-2 text-[12.5px] sm:px-6" aria-live="polite">
        {awaitingApproval && !working ? (
          <p className="text-warn">{t("office.approval")}</p>
        ) : working ? (
          <p className="text-ink"><span className="text-mute">{t("office.now")} · </span>
            <span className="font-medium">{t(`role.${working.id}` as Key)}</span>
            <span className="text-mute"> — {taskOf(t, working.current?.name, working.current?.detail)}{working.current?.detail ? ` (${working.current.detail})` : ""}</span>
          </p>
        ) : job?.status === "failed" ? (
          <p className="text-bad">{t("office.problem", { error: job.error ?? "" })}</p>
        ) : job?.status === "completed" ? (
          <p className="text-mute">{t("office.finished")}{finalEvent?.message ? ` ${finalEvent.message}.` : ""}</p>
        ) : job ? <p className="text-mute">{t("office.queued")}</p> : <p className="text-mute">{t("office.idleAll")}</p>}
        {repairs > 0 && <span className="text-[11.5px] text-warn">↺ {t("office.repairs", { n: repairs })}</span>}
        <span className="ml-auto hidden text-[11px] text-faint md:inline">{t("office.sequential")}</span>
      </div>
    </section>
  );
}

function Station({ v, selected, onSelect, elapsed }: { v: AgentView; selected: boolean; onSelect: (r: AgentId) => void; elapsed: number | null }) {
  const t = useT();
  const role = t(`role.${v.id}` as Key);
  const last = v.last && v.last.kind !== "started" ? v.last : undefined;
  return (
    <li data-testid={`role-${v.id}`} data-state={v.state} className="relative z-[1] flex min-w-0 flex-col items-center px-0.5 text-center">
      <button type="button" onClick={() => onSelect(v.id)} aria-pressed={selected}
        aria-label={`${role}: ${t(`agent.${v.state}` as Key)}`}
        className={`rounded-full p-1 transition-colors ${selected ? "bg-hover ring-1 ring-line-strong" : "hover:bg-hover/70"}`}>
        <AgentBadge role={v.id} state={v.state} />
      </button>
      <p className="mt-1 truncate text-[12.5px] font-medium text-ink">{role}</p>
      <p className={`flex items-center gap-1 text-[11px] ${STATE_TEXT[v.state]}`}>
        {v.state === "working" && <Bars />}{t(`agent.${v.state}` as Key)}
        {elapsed !== null && <span className="tabular-nums text-faint">· {fmtSecs(elapsed)}</span>}
      </p>
      <p className="mt-0.5 hidden min-h-[2.5em] text-[11px] leading-snug text-mute sm:line-clamp-2">
        {v.state === "working" ? taskOf(t, v.current?.name, v.current?.detail)
          : last ? `${taskOf(t, last.stage, last.label)}${last.detail ? ` — ${last.detail}` : ""}` : t(`role.${v.id}.does` as Key)}
      </p>
      <span className="mt-1 flex gap-1" aria-label={`${v.done}/${v.total}`}>
        {Array.from({ length: v.total }, (_, i) => {
          const s = v.stages[i]?.status;
          return <i key={i} className={`h-1 w-3 rounded-full ${s === "passed" ? "bg-ok/70" : s === "failed" ? "bg-bad/80" : s === "running" ? "bg-accent-ink" : s === "skipped" ? "bg-line-strong" : "bg-line"}`} />;
        })}
      </span>
    </li>
  );
}

function StepLine({ s, running }: { s: Step; running?: boolean }) {
  const t = useT();
  const status = running ? "running" : s.kind === "error" ? "failed" : s.kind === "completed" ? "passed" : s.kind;
  return (
    <li className="flex items-start gap-2 text-[12px]">
      <span className="mt-px"><StepMark status={status} /></span>
      <span className="min-w-0 flex-1">
        <span className="text-ink/90">{s.kind === "completed" ? s.detail : taskOf(t, s.stage, s.label)}</span>
        {s.kind !== "completed" && (running ? s.label : s.detail) && <span className="text-mute"> — {running ? s.label : s.detail}</span>}
      </span>
      <time className="shrink-0 tabular-nums text-faint" dateTime={s.ev.at}>{new Date(s.ev.at).toLocaleTimeString()}</time>
    </li>
  );
}

/** Live activity, grouped into turns: which agent worked, what it did, how it ended, and why a repair happened. */
export function ActivityStream({ job }: { job: Job }) {
  const t = useT();
  const events = useRunEvents(job, true);
  const ts = turns(events);
  const isLive = live(job);
  if (!ts.length) return <p className="text-xs text-faint">{t("office.noActivity")}</p>;
  return (
    <ol aria-label={t("office.activity")} className="space-y-0">
      {ts.map((turn, i) => {
        const steps = turn.steps.filter((s, k) => s.kind !== "started" || (k === turn.steps.length - 1 && isLive));
        const state: AgentState = turn.outcome === "running" ? (isLive ? "working" : "waiting") : turn.outcome === "failed" ? "failed" : turn.outcome === "skipped" ? "waiting" : "done";
        return (
          <li key={`${i}-${turn.steps[0].ev.id}`} data-role={turn.role} data-outcome={turn.outcome} className={`relative flex gap-3 pb-3 ${isLive ? "step-in" : ""}`}>
            {i < ts.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[13px] top-8 w-px bg-line" />}
            <AgentBadge role={turn.role} state={state} size={28} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="flex flex-wrap items-center gap-x-2 text-[12.5px]">
                <span className="font-medium text-ink">{t(`role.${turn.role}` as Key)}</span>
                {turn.repair && <Pill tone="warn">{t("insp.round", { n: turn.repair })} · {t("flow.repair")}</Pill>}
                {turn.outcome === "failed" && <Pill tone="bad">{t("agent.failed")}</Pill>}
                {turn.outcome === "skipped" && <span className="text-[11px] text-faint">{t("office.skipped")}</span>}
              </p>
              {turn.reason && (
                <p className="mt-0.5 text-[11.5px] text-warn">
                  {t("office.sentBack", { role: t(`role.${turn.reason.role}` as Key) })}: {taskOf(t, turn.reason.stage)}{turn.reason.detail ? ` — ${turn.reason.detail}` : ""}
                </p>
              )}
              <ul className="mt-1 space-y-1">
                {steps.map((s, k) => <StepLine key={s.ev.id} s={s} running={s.kind === "started" && k === steps.length - 1} />)}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
