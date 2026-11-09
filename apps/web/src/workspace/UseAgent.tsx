/** "What can I do with it now?": only actions the backend supports for this version's real status. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { API, api, type Report, type VersionDetail } from "../api";
import { useT } from "../i18n";
import { href } from "../route";
import { CodeI, Download, Flask, Folder, Globe } from "./icons";
import { ErrorNote, StatusPill, sectionTitle } from "./kit";

const link = "inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-xs font-medium text-ink hover:border-line-strong hover:bg-hover";
const bigBtn = "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-raised px-4 text-sm font-medium text-ink transition-colors hover:border-accent/40 hover:bg-hover";

export function UseAgent({ v, onView }: { v: VersionDetail; onView: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const retest = useMutation({
    mutationFn: () => api<{ report: Report }>(`/studio/versions/${v.id}/validate`, { method: "POST" }),
    onSuccess: () => ["version", "skills", "evaluations"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
  if (v.status === "validation_failed") {
    return (
      <div className="flex flex-wrap gap-2" aria-label={t("use.title")}>
        <a className={link} href={href("code", v.id, "validation")}>{t("use.whatFailed")}</a>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-accent/25 bg-accent/5 px-4 py-3.5" role="group" aria-label={t("use.title")}>
      <p className="text-sm font-semibold text-ink">{t("use.title")}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <button type="button" className={bigBtn} onClick={onView}><CodeI size={14} />{t("use.view")}</button>
        <a className={bigBtn} href={`${API}/studio/versions/${v.id}/export/canonical`} download><Download size={14} />{t("use.download")}</a>
        <a className={bigBtn} href={href("projects")}><Folder size={14} />{t("use.project")}</a>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className={link} href={href("code", v.id, "export")}><Globe size={13} />{t("use.export")}</a>
        <button type="button" className={link} disabled={retest.isPending} onClick={() => retest.mutate()}>
          <Flask size={13} />{retest.isPending ? t("ag.testing") : t("use.retest")}
        </button>
      </div>
      {retest.error && <ErrorNote error={retest.error} />}
      {retest.data && <p className="flex items-center gap-2 text-xs text-mute" role="status">{t("use.retested")} <StatusPill status={retest.data.report.status} /></p>}
    </div>
  );
}
