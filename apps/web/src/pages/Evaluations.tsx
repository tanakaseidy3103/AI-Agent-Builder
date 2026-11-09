/** Evaluations: the latest real validation run of every version. Verified comes only from the backend's verdict. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type EvalSkill, type VersionStatus } from "../api";
import { useT, type Key } from "../i18n";
import { href } from "../route";
import { reached } from "../workspace/evidence";
import { Flask } from "../workspace/icons";
import { Button, Empty, ErrorNote, PageHeader, StatusPill, StepMark, Tabs, card } from "../workspace/kit";
import { Ladder } from "../workspace/Ladder";
import { VersionChart } from "../workspace/VersionChart";
import { when } from "./Overview";

type Filter = "all" | VersionStatus;
const KNOWN = new Set(["static", "unit_tests", "eval_cases"]);

/** Re-runs the real validation (static checks + Docker sandbox) for one stored version. */
function RunAgain({ versionId }: { versionId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api<{ report: { status: string } }>(`/studio/versions/${versionId}/validate`, { method: "POST" }),
    onSuccess: () => ["evaluations", "skills", "version"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
  return (
    <span className="flex items-center gap-2">
      <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()}><Flask size={13} />{run.isPending ? t("ag.testing") : t("ev.runAgain")}</Button>
      {run.error && <span className="text-xs text-bad" role="alert">{run.error instanceof Error ? run.error.message : String(run.error)}</span>}
    </span>
  );
}

export function Evaluations() {
  const t = useT();
  const q = useQuery({ queryKey: ["evaluations"], queryFn: () => api<EvalSkill[]>("/studio/evaluations") });
  const [filter, setFilter] = useState<Filter>("all");
  const rows = (q.data ?? []).flatMap((s) => s.versions.map((v) => ({ ...v, slug: s.slug, name: s.name })))
    .sort((a, b) => b.validated_at.localeCompare(a.validated_at));
  const n = (st: Filter) => rows.filter((r) => st === "all" || r.status === st).length;
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  // agents refined at least once: the only ones where "did it improve?" has an answer
  const multi = (q.data ?? []).filter((s) => s.versions.length >= 2).sort((a, b) => b.versions.length - a.versions.length);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t("nav.evaluations")} body={t("ev.body")} />
      {multi.length > 0 && (
        <section aria-label={t("chart.section")} className="space-y-3 px-4 pt-4 sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-ink">{t("chart.section")}</h2>
            <p className="text-[12.5px] text-mute">{t("chart.sectionBody")}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {multi.map((s) => <VersionChart key={s.slug} name={s.name} versions={s.versions} />)}
          </div>
        </section>
      )}
      <Tabs label={t("ev.filter")} value={filter} onChange={setFilter} items={([
        ["all", t("ev.all")], ["verified", t("st.verified")], ["validated", t("st.validated")], ["validation_failed", t("st.validation_failed")],
      ] as [Filter, string][]).map(([id, label]) => ({ id, label, count: n(id) }))} />
      <div className="space-y-2 px-4 py-4 sm:px-6">
        {q.error && <ErrorNote error={q.error} />}
        {q.isPending && <p className="text-sm text-mute">{t("skills.loading")}</p>}
        {q.data && shown.length === 0 && <Empty icon={<Flask size={16} />} title={t("ev.none")} />}
        <ul className="space-y-2">
          {shown.map((r) => {
            const testsFailed = r.tests_total - r.tests_passed, evalsFailed = r.evals_total - r.evals_passed;
            return (
              <li key={r.version_id} className={card} data-testid={`eval-${r.slug}-${r.version}`}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{r.name}</span>
                      <span className="block truncate font-mono text-[11px] text-faint">{r.slug}@{r.version} · {r.model ?? "—"} · {when(r.validated_at)}</span>
                    </span>
                    <Ladder levels={reached(r.status, r.criteria, r.tests_total + r.evals_total > 0)} />
                    <span className="text-[12px] tabular-nums text-mute">
                      {t("ev.tests")} <b className="text-ok" title={t("ev.passed")}>✓ {r.tests_passed}</b>{testsFailed > 0 && <> <b className="text-bad" title={t("ev.failed")}>✗ {testsFailed}</b></>}
                      {" · "}{t("ev.cases")} <b className="text-ok" title={t("ev.passed")}>✓ {r.evals_passed}</b>{evalsFailed > 0 && <> <b className="text-bad" title={t("ev.failed")}>✗ {evalsFailed}</b></>}
                    </span>
                    <StatusPill status={r.status} />
                  </summary>
                  <div className="space-y-2 border-t border-line px-4 py-3">
                    <ul className="space-y-2.5">
                      {r.criteria.map((c) => (
                        <li key={c.id} className="flex items-start gap-2 text-[12.5px]">
                          <StepMark status={c.passed ? "pass" : "fail"} />
                          <span className="min-w-0">
                            <span className="block text-ink">{KNOWN.has(c.id) ? t(`crit.${c.id}` as Key) : c.id}
                              <span className={c.passed ? "text-mute" : "text-bad"}> — {c.detail}</span></span>
                            {!c.passed && KNOWN.has(c.id) && <span className="block text-mute">{t(`crit.${c.id}.fail` as Key)}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[12px] text-faint">{t("ev.meta", { runs: r.runs, repairs: r.repair_rounds ?? 0, ms: r.duration_ms })}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <a href={href("code", r.version_id, "validation")} className="text-[12.5px] text-accent-ink hover:underline">{t("ev.open")}</a>
                      <RunAgain versionId={r.version_id} />
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
