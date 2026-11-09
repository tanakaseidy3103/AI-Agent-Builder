/**
 * "Did refining help?": share of real checks (unit tests + evaluation cases) that passed in each version of one agent.
 * One series -> no legend box (the title names it); value printed on each bar; status as icon + text, never colour alone;
 * hover/focus tooltip; a table view for screen readers and anyone who prefers numbers.
 */
import type { EvalVersion } from "../api";
import { useT, type Key } from "../i18n";

const MARK: Record<string, [string, string]> = { verified: ["✓", "text-ok"], validated: ["!", "text-warn"], validation_failed: ["✗", "text-bad"] };

export const passShare = (v: EvalVersion) => {
  const total = v.tests_total + v.evals_total;
  return total ? (v.tests_passed + v.evals_passed) / total : null; // null: nothing was executed (e.g. failed before the sandbox)
};

export function VersionChart({ name, versions }: { name: string; versions: EvalVersion[] }) {
  const t = useT();
  const rows = [...versions].sort((a, b) => a.validated_at.localeCompare(b.validated_at));
  return (
    <figure className="min-w-0 rounded-lg border border-line bg-panel p-4" aria-label={t("chart.title", { name })}>
      <figcaption>
        <p className="text-[13px] font-medium text-ink">{t("chart.title", { name })}</p>
        <p className="text-[12px] text-mute">{t("chart.subtitle")}</p>
      </figcaption>
      <div className="mt-3 flex h-36 items-end gap-2 border-b border-line-strong" aria-hidden="true">
        {rows.map((v) => {
          const share = passShare(v);
          const pct = share === null ? null : Math.round(share * 100);
          const tip = `v${v.version} · ${t(`st.${v.status}` as Key)} · ${t("ev.counts", { tp: v.tests_passed, tt: v.tests_total, ep: v.evals_passed, et: v.evals_total })}`;
          return (
            <div key={v.version_id} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={tip}>
              <span className="mb-1 text-[12px] tabular-nums text-ink">{pct === null ? "—" : `${pct}%`}</span>
              {pct === null ? <span className="h-px w-full max-w-10 bg-line-strong" />
                : <span className="w-full max-w-10 rounded-t-[4px] bg-accent transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(pct, 1)}%` }} />}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2" aria-hidden="true">
        {rows.map((v) => {
          const [icon, tone] = MARK[v.status] ?? ["·", "text-faint"];
          return (
            <div key={v.version_id} className="min-w-0 flex-1 text-center leading-tight">
              <p className="truncate font-mono text-[11px] text-mute">v{v.version}</p>
              <p className="truncate text-[11px] text-ink"><span className={tone}>{icon}</span> {t(`st.${v.status}` as Key)}</p>
            </div>
          );
        })}
      </div>
      <details className="mt-2 text-[12px]">
        <summary className="cursor-pointer text-mute hover:text-ink">{t("chart.table")}</summary>
        <table className="mt-1.5 w-full text-left tabular-nums">
          <thead className="text-mute"><tr><th className="font-normal">{t("version")}</th><th className="font-normal">{t("chart.passed")}</th><th className="font-normal">{t("ev.tests")}</th><th className="font-normal">{t("ev.cases")}</th><th className="font-normal">{t("chart.status")}</th></tr></thead>
          <tbody className="text-ink">
            {rows.map((v) => {
              const s = passShare(v);
              return (
                <tr key={v.version_id}><td className="font-mono">v{v.version}</td><td>{s === null ? "—" : `${Math.round(s * 100)}%`}</td>
                  <td>{v.tests_passed}/{v.tests_total}</td><td>{v.evals_passed}/{v.evals_total}</td><td>{t(`st.${v.status}` as Key)}</td></tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
