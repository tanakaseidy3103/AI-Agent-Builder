/** The agent being built, as one small SVG robot whose state is botState(job, stored status): never simulated. */
import type { Job } from "../api";
import { useT, type Key } from "../i18n";
import { JOURNEY, journey, type BotState, type StepState } from "./agents";

const STEP: Record<StepState, string> = {
  done: "text-ok", current: "bg-accent/15 font-medium text-accent-ink", failed: "bg-bad/10 font-medium text-bad",
  warn: "bg-warn/10 font-medium text-warn", todo: "text-faint",
};
import { taskOf } from "./Office";

const ACTIVE: BotState[] = ["analyzing", "planning", "generating", "reviewing", "testing"];
const TONE: Record<BotState, string> = {
  idle: "text-faint", analyzing: "text-accent-ink", planning: "text-accent-ink", generating: "text-accent-ink",
  reviewing: "text-info", testing: "text-info", completed: "text-ok", failed: "text-bad",
};

function Robot({ state }: { state: BotState }) {
  const active = ACTIVE.includes(state);
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" className="shrink-0" data-bot={state}>
      <line x1="32" y1="6" x2="32" y2="14" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="6" r="3" fill="currentColor" className={active ? "bot-pulse" : ""} />
      <rect x="12" y="14" width="40" height="30" rx="8" fill="var(--color-raised)" stroke="currentColor" strokeWidth="2" />
      {state === "failed" ? (
        <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M22 25l6 6M28 25l-6 6M36 25l6 6M42 25l-6 6" />
        </g>
      ) : state === "completed" ? (
        <path d="M22 29l4 4 6-7M36 29l4 4 6-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <g fill="currentColor">
          <rect x="21" y="25" width="8" height={state === "idle" ? 3 : 8} rx="2" className={active ? "bot-blink" : ""} />
          <rect x="35" y="25" width="8" height={state === "idle" ? 3 : 8} rx="2" className={active ? "bot-blink" : ""} />
        </g>
      )}
      <rect x="22" y="37" width="20" height="2.5" rx="1.25" fill="currentColor" opacity="0.5" />
      <rect x="18" y="48" width="28" height="10" rx="4" fill="var(--color-raised)" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function StudioBot({ job, state, versionStatus, awaitingApproval }: { job?: Job; state: BotState; versionStatus?: string; awaitingApproval: boolean }) {
  const t = useT();
  const running = job?.stages.find((s) => s.status === "running");
  const steps = journey(job, versionStatus, awaitingApproval);
  // finished but tests/evals failed: not a success, so never shown in the success colour
  const unverified = state === "completed" && versionStatus !== "verified";
  const tone = unverified ? "text-warn" : TONE[state];
  const next: Key = awaitingApproval ? "bot.next.approve"
    : state === "idle" ? (job ? "bot.next.queued" : "bot.next.describe")
    : state === "failed" ? (job?.status === "failed" ? "bot.next.retry" : "bot.next.fix")
    : state === "completed" ? (versionStatus === "verified" ? "bot.next.export" : "bot.next.review")
    : "bot.next.wait";
  return (
    <section aria-label={t("bot.title")} data-testid="studio-bot" data-state={state} data-verified={state === "completed" ? !unverified : undefined}
      className="space-y-2.5 border-b border-line px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={tone}><Robot state={state} /></span>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className={`text-sm font-semibold ${tone}`}>{unverified ? t("bot.unverified") : t(`bot.${state}` as Key)}</p>
          {running && <p className="truncate text-[12.5px] text-ink/90">{taskOf(t, running.name, running.detail)}{running.detail ? ` (${running.detail})` : ""}</p>}
          <p className="text-[12px] text-mute">{t(next)}</p>
        </div>
      </div>
      <ol aria-label={t("journey.title")} className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[12px]" data-testid="journey">
        {JOURNEY.map((k, i) => {
          const s = steps[i];
          return (
            <li key={k} data-step={k} data-state={s} aria-current={s === "current" ? "step" : undefined} className="flex items-center gap-1">
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${STEP[s]}`}>
                <span aria-hidden="true">{s === "done" ? "✓" : s === "failed" ? "✗" : s === "warn" ? "!" : `${i + 1}`}</span>
                {t(`journey.${k}` as Key)}<span className="sr-only"> ({t(`journey.state.${s}` as Key)})</span>
              </span>
              {i < JOURNEY.length - 1 && <span aria-hidden="true" className="text-faint">›</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
