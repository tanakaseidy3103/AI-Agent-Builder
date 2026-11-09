/** Overview: counts, what needs attention and recent items, straight from the backend. Nothing estimated or invented. */
import { useQuery } from "@tanstack/react-query";
import { api, type EvalSkill, type Job, type OfficeAgent, type SkillRow } from "../api";
import { useT, type Key } from "../i18n";
import { href } from "../route";
import { reached } from "../workspace/evidence";
import { Alert, Plus } from "../workspace/icons";
import { ErrorNote, PageHeader, StatusPill, card, sectionTitle } from "../workspace/kit";
import { Ladder } from "../workspace/Ladder";

export const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

const BAR: Record<string, string> = { verified: "bg-ok", validated: "bg-info", validation_failed: "bg-bad" };

export function Overview() {
  const t = useT();
  const skills = useQuery({ queryKey: ["skills"], queryFn: () => api<SkillRow[]>("/studio/skills") });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api<Job[]>("/studio/jobs") });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<OfficeAgent[]>("/studio/agents") });
  const evals = useQuery({ queryKey: ["evaluations"], queryFn: () => api<EvalSkill[]>("/studio/evaluations") });

  const latest = (skills.data ?? []).filter((s) => s.latest);
  const count = (st?: string) => (skills.data ? latest.filter((s) => !st || s.latest!.status === st).length : undefined);
  const versions = (evals.data ?? []).flatMap((s) => s.versions.map((v) => ({ ...v, slug: s.slug })));
  const evalOf = new Map(versions.map((v) => [v.version_id, v] as const));
  const attention = latest.filter((s) => s.latest!.status !== "verified").slice(0, 6);
  const activity = (agents.data ?? []).flatMap((a) => a.recent).sort((a, b) => b.id - a.id).slice(0, 8);
  const recentEvals = [...versions].sort((a, b) => b.validated_at.localeCompare(a.validated_at)).slice(0, 4);
  const error = skills.error ?? jobs.error ?? agents.error ?? evals.error;
  const total = count() ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t("nav.overview")} body={t("ov.body")}>
        <a href={href("studio")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90"><Plus size={14} />{t("ov.create")}</a>
      </PageHeader>
      <div className="space-y-5 px-4 py-5 sm:px-6">
        {error && <ErrorNote error={error} />}

        <section aria-label={t("how.title")} className={`${card} p-4`}>
          <p className="text-[13px] leading-relaxed text-ink">{t("how.what")}</p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {(["describe", "create", "test", "use"] as const).map((k, i) => (
              <li key={k} className="flex gap-2.5 rounded-md border border-line bg-canvas px-3 py-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-[12px] font-semibold text-accent-ink">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{t(`how.${k}` as Key)}</span>
                  <span className="block text-[12px] leading-snug text-mute">{t(`how.${k}.body` as Key)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label={t("ov.summary")} className={`${card} px-4 py-3`}>
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            {([["ov.agents", count(), "text-ink"], ["ov.verified", count("verified"), "text-ok"], ["ov.validated", count("validated"), "text-info"],
              ["ov.failed", count("validation_failed"), "text-bad"]] as [Key, number | undefined, string][]).map(([k, n, tone]) => (
              <div key={k} className="flex items-baseline gap-2">
                <dt className="order-2 text-[12.5px] text-mute">{t(k)}</dt>
                <dd className={`order-1 text-xl font-semibold tabular-nums ${tone}`}>{n ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {total > 0 && (
            <div className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full" role="img"
              aria-label={t("ov.barLabel", { v: count("verified") ?? 0, a: count("validated") ?? 0, f: count("validation_failed") ?? 0, n: total })}>
              {(["verified", "validated", "validation_failed"] as const).filter((st) => (count(st) ?? 0) > 0).map((st) => (
                <span key={st} className={BAR[st]} style={{ width: `${(100 * (count(st) ?? 0)) / total}%` }}
                  title={`${t(`st.${st}`)}: ${count(st)} / ${total} (${Math.round((100 * (count(st) ?? 0)) / total)}%)`} />
              ))}
            </div>
          )}
          {total > 0 && (
            <p className="mt-2 text-[12px] leading-relaxed text-mute">
              <span className="text-ok">✓</span> {t("ov.legend.verified")} · <span className="text-info">!</span> {t("ov.legend.validated")} · <span className="text-bad">✗</span> {t("ov.legend.failed")}
            </p>
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <section aria-label={t("ov.attention")} className={`${card} min-w-0 p-4`}>
            <h2 className={`${sectionTitle} mb-2 flex items-center gap-1.5`}><Alert size={13} className="text-warn" />{t("ov.attention")}</h2>
            {skills.data && attention.length === 0 && <p className="text-[12.5px] text-mute">{total ? t("ov.allVerified") : t("ov.noAgents")}</p>}
            <ul className="divide-y divide-line">
              {attention.map((s) => {
                const failing = evalOf.get(s.latest!.id)?.criteria.filter((c) => !c.passed) ?? [];
                return (
                  <li key={s.id} className="min-w-0 py-2">
                    <a href={href("code", s.latest!.id, "validation")} className="flex items-center justify-between gap-2 text-[13px] text-ink hover:text-accent-ink">
                      <span className="truncate font-medium">{s.name}</span><StatusPill status={s.latest!.status} />
                    </a>
                    <p className="mt-0.5 truncate text-[12px] text-mute">
                      {failing.length ? failing.map((c) => `${c.id}: ${c.detail}`).join(" · ") : t("ag.noEval")}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-label={t("ws.recent")} className={`${card} min-w-0 p-4`}>
            <h2 className={`${sectionTitle} mb-2`}>{t("ws.recent")}</h2>
            {jobs.data?.length === 0 && <p className="text-[12.5px] text-mute">{t("ws.noRecent")}</p>}
            <ul className="divide-y divide-line">
              {jobs.data?.slice(0, 5).map((j) => (
                <li key={j.id} className="min-w-0 py-2">
                  <a href={j.skill_version_id ? href("code", j.skill_version_id) : href("studio")} className="group block">
                    <p className="truncate text-[13px] text-ink group-hover:text-accent-ink" title={j.prompt}>{j.prompt}</p>
                    <p className="mt-1 flex items-center gap-2 text-[12px] text-faint"><StatusPill status={j.status} />{when(j.created_at)}</p>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label={t("ov.activity")} className={`${card} min-w-0 p-4`}>
            <h2 className={`${sectionTitle} mb-2`}>{t("ov.activity")}</h2>
            {agents.data && activity.length === 0 && <p className="text-[12.5px] text-mute">{t("office.noActivity")}</p>}
            <ol className="space-y-1.5">
              {activity.map((e) => (
                <li key={e.id} className="flex min-w-0 gap-2 text-[12.5px]">
                  <span className="w-24 shrink-0 truncate text-mute">{t(`role.${e.agent_id}` as Key)}</span>
                  <span className={`min-w-0 flex-1 truncate ${e.state === "failed" ? "text-bad" : "text-ink/90"}`} title={e.message ?? ""}>{e.message}</span>
                  <time className="shrink-0 tabular-nums text-faint" dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time>
                </li>
              ))}
            </ol>
          </section>

          <section aria-label={t("ov.evaluations")} className={`${card} min-w-0 p-4`}>
            <h2 className={`${sectionTitle} mb-2`}>{t("ov.evaluations")}</h2>
            {evals.data && recentEvals.length === 0 && <p className="text-[12.5px] text-mute">{t("ev.none")}</p>}
            <ul className="divide-y divide-line">
              {recentEvals.map((v) => (
                <li key={v.version_id} className="min-w-0 space-y-1 py-2">
                  <a href={href("code", v.version_id, "validation")} className="flex items-center justify-between gap-2 text-[13px] text-ink hover:text-accent-ink">
                    <span className="truncate font-mono">{v.slug}@{v.version}</span><StatusPill status={v.status} />
                  </a>
                  <Ladder levels={reached(v.status, v.criteria, v.tests_total + v.evals_total > 0)} />
                  <p className="text-[12px] text-faint">{t("ev.counts", { tp: v.tests_passed, tt: v.tests_total, ep: v.evals_passed, et: v.evals_total })} · {when(v.validated_at)}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
