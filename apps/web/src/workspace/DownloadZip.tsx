/** Download an exported Skill ZIP. Local mode: a plain link (unchanged). Demo mode: a button that downloads through
 * apiFetch, because a link cannot carry the visitor's session header. */
import { useState, type ReactNode } from "react";
import { API, DEMO, apiPath, download } from "../api";

export function DownloadZip({ path, filename, className, children }: { path: string; filename?: string; className: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!DEMO) return <a className={className} href={`${API}${apiPath(path)}`} download={filename ?? true}>{children}</a>;
  return (
    <>
      <button type="button" className={className} disabled={busy} aria-busy={busy}
        onClick={async () => {
          setBusy(true); setError(null);
          try { await download(path, filename ?? "skill.zip"); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
        }}>
        {children}
      </button>
      {error && <span role="alert" className="basis-full text-xs text-bad">{error}</span>}
    </>
  );
}
