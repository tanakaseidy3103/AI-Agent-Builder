/** Right pane while a run is in focus: the selected agent, its current task, its stages, results per round and evidence. */
import type { AgentId, Job } from "../api";
import { useT, type Key } from "../i18n";
import { Button, Pill, StepMark, sectionTitle } from "./kit";
import { AgentBadge, fmtSecs, taskOf, useElapsed, useRunEvents } from "./Office";
import { ROLE_STAGES, agentViews, parseEvent } from "./agents";

const STATE_TONE = { working: "accent", done: "ok", failed: "bad", waiting: "mute" } as const;

export function AgentPanel({ job, role, onOpenResult }: { job: Job; role: AgentId; onOpenResult: (id: string) => void }) {
  const t = useT();
  const events = useRunEvents(job);
  const v = agentViews(job, events).find((a) => a.id === role)!;
  const elapsed = useElapsed(v.startedAt, v.state === "working");
  const mine = events.filter((e) => e.agent_id === role).map(parseEvent);
  const results = mine.filter((s) => s.kind !== "started" && s.kind !== "other");
  const plan = job.stages.find((s) => s.name === "plan" && s.status === "passed")?.detail;
  const spec = job.stages.find((s) => s.name === "specify" && s.status === "passed")?.detail;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agent-panel" data-role={role}>
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <AgentBadge role={role} state={v.state} size={36} />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">{t(`role.${role}` as Key)}
            <Pill tone={STATE_TONE[v.state]}>{t(`agent.${v.state}` as Key)}</Pill></h2>
          <p className="text-xs text-mute">{t(`role.${role}.does` as Key)}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section>
          <h3 className={`${sectionTitle} mb-1.5`}>{t("agent.task")}</h3>
          {v.state === "working" ? (
            <p className="text-sm text-ink">{taskOf(t, v.current?.name, v.current?.detail)}
              {v.current?.detail && <span className="text-mute"> ({v.current.detail})</span>}
              {elapsed !== null && <span className="ml-2 tabular-nums text-faint">{fmtSecs(elapsed)}</span>}</p>
          ) : (
            <p className="text-sm text-mute">{v.state === "waiting" && v.done === 0 ? t("agent.notStarted") : t("agent.noCurrent")}</p>
          )}
        </section>

        <section>
          <h3 className={`${sectionTitle} mb-1.5`}>{t("agent.stages")} <span className="normal-case tracking-normal">{v.done}/{v.total}</span></h3>
          <ul className="divide-y divide-line rounded-md border border-line">
            {ROLE_STAGES[role].map((name) => {
              const s = v.stages.find((x) => x.name === name);
              return (
                <li key={name} className="flex items-start gap-2 px-3 py-2 text-[12.5px]">
                  <StepMark status={s?.status ?? "pending"} />
                  <span className="min-w-0 flex-1"><span className="text-ink">{taskOf(t, name)}</span>
                    {s?.detail && <span className="block break-words text-[11.5px] text-mute">{s.detail}</span>}</span>
                  {s?.duration_ms ? <span className="shrink-0 tabular-nums text-[11px] text-faint">{(s.duration_ms / 1000).toFixed(1)}s</span> : null}
                </li>
              );
            })}
          </ul>
        </section>

        {role === "architect" && (spec || plan) && (
          <section>
            <h3 className={`${sectionTitle} mb-1.5`}>{t("agent.plannedFiles")}</h3>
            {spec && <p className="mb-2 font-mono text-[11.5px] text-mute">{spec}</p>}
            <ul className="flex flex-wrap gap-1">{plan?.split(", ").map((f) => <li key={f}><Pill>{f}</Pill></li>)}</ul>
          </section>
        )}
        {role === "coder" && v.repairs > 0 && <p className="text-xs text-warn">↺ {t("office.repairs", { n: v.repairs })}</p>}

        <section>
          <h3 className={`${sectionTitle} mb-1.5`}>{t("agent.results")}</h3>
          {results.length === 0 ? <p className="text-xs text-faint">{t("agent.noResults")}</p> : (
            <ol className="space-y-1.5" aria-label={t("agent.results")}>
              {results.map((s) => (
                <li key={s.ev.id} className="flex items-start gap-2 text-[12px]">
                  <StepMark status={s.kind === "error" ? "failed" : s.kind === "completed" ? "passed" : s.kind} />
                  <span className="min-w-0 flex-1 break-words"><span className="text-ink/90">{s.kind === "completed" ? s.detail : taskOf(t, s.stage, s.label)}</span>
                    {s.kind !== "completed" && s.detail && <span className="text-mute"> — {s.detail}</span>}</span>
                  <time className="shrink-0 tabular-nums text-[11px] text-faint" dateTime={s.ev.at}>{new Date(s.ev.at).toLocaleTimeString()}</time>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-md border border-line bg-canvas px-3 py-2.5 text-xs text-mute">
          {job.skill_version_id ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{t("agent.packaged")}</span>
              <Button size="sm" variant="primary" onClick={() => onOpenResult(job.skill_version_id!)}>{t("agent.openSkill")}</Button>
            </div>
          ) : t("agent.filesLater")}
        </section>
      </div>
    </div>
  );
}

