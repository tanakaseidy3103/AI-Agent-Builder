/** "What can I do with it now?": only actions the backend supports for this version's real status. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { API, api, type Report, type VersionDetail } from "../api";
import { useT } from "../i18n";
import { href } from "../route";
import { CodeI, Download, Flask, Folder, Globe } from "./icons";
import { ErrorNote, StatusPill, sectionTitle } from "./kit";

const link = "inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-xs font-medium text-ink hover:border-line-strong hover:bg-hover";

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
    <div className="space-y-2 border-t border-line pt-3" role="group" aria-label={t("use.title")}>
      <p className={sectionTitle}>{t("use.title")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={link} onClick={onView}><CodeI size={13} />{t("use.view")}</button>
        <a className={link} href={`${API}/studio/versions/${v.id}/export/canonical`} download><Download size={13} />{t("use.download")}</a>
        <a className={link} href={href("code", v.id, "export")}><Globe size={13} />{t("use.export")}</a>
        <a className={link} href={href("projects")}><Folder size={13} />{t("use.project")}</a>
        <button type="button" className={link} disabled={retest.isPending} onClick={() => retest.mutate()}>
          <Flask size={13} />{retest.isPending ? t("ag.testing") : t("use.retest")}
        </button>
      </div>
      {retest.error && <ErrorNote error={retest.error} />}
      {retest.data && <p className="flex items-center gap-2 text-xs text-mute" role="status">{t("use.retested")} <StatusPill status={retest.data.report.status} /></p>}
    </div>
  );
}
