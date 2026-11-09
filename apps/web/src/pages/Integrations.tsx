/** Integrations: where agents can be used, and the real state of the local model connection. */
import { useQuery } from "@tanstack/react-query";
import { api, type Integration, type Models } from "../api";
import { useT } from "../i18n";
import { href } from "../route";
import { Check, Chip, Globe, Key, Plug } from "../workspace/icons";
import { ErrorNote, PageHeader, Pill, card, sectionTitle } from "../workspace/kit";

export function Integrations() {
  const t = useT();
  const targets = useQuery({ queryKey: ["integrations"], queryFn: () => api<Integration[]>("/studio/integrations") });
  // "loaded now" changes over time: this page refreshes it on open (other screens reuse the cached list)
  const models = useQuery({ queryKey: ["models"], queryFn: () => api<Models>("/studio/models"), staleTime: 0 });
  const m = models.data;
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t("nav.integrations")} body={t("int.body")} />
      <div className="grid gap-4 px-4 py-5 sm:px-6 xl:grid-cols-2">
        <section aria-label={t("int.tools")} className={`${card} space-y-3 p-4 xl:col-span-2`}>
          <h2 className={`${sectionTitle} flex items-center gap-1.5`}><Plug size={13} />{t("int.tools")}</h2>
          {targets.error && <ErrorNote error={targets.error} />}
          <ul className="grid gap-2 md:grid-cols-2">
            {targets.data?.map((x) => (
              <li key={x.id} className="rounded-md border border-line bg-canvas p-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-ink">{x.label}<Pill>{x.scope}</Pill></p>
                <p className="mt-1 text-[12px] leading-relaxed text-mute">{x.notes}</p>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-faint">{t("int.toolsHow")}</p>
        </section>

        <section aria-label={t("int.ollama")} className={`${card} space-y-2 p-4`}>
          <h2 className={`${sectionTitle} flex items-center gap-1.5`}><Chip size={13} />{t("int.ollama")}</h2>
          {models.error && <ErrorNote error={models.error} />}
          {m?.error && <><ErrorNote error={m.error} /><p className="text-[12.5px] text-mute">{t("int.fixOllama")}</p></>}
          {m && !m.error && !m.installed.includes(m.default) && (
            <p role="alert" className="rounded-md border border-warn/30 bg-warn/[0.07] px-3 py-2 text-[12.5px] text-ink">
              {t("int.defaultMissing", { model: m.default })} <code className="font-mono text-warn">ollama pull {m.default}</code>
            </p>
          )}
          {m && !m.error && <p className="flex items-center gap-1.5 text-[13px] text-ok" role="status"><Check size={13} />{t("int.connected", { n: m.installed.length })}</p>}
          {m && <p className="text-[12px] text-mute">{t("int.default")}: <span className="font-mono text-ink">{m.default}</span></p>}
          {m && !m.error && (
            <div className="text-[12px] text-mute" data-testid="ollama-runtime">
              <p className="font-medium text-ink">{t("int.loaded")}</p>
              {(m.runtime ?? []).length === 0 ? <p>{t("int.noneLoaded")}</p> : (
                <ul className="mt-1 space-y-0.5">
                  {m.runtime!.map((r) => (
                    <li key={r.name} className="font-mono">{r.name} · {(r.size / 1e9).toFixed(1)} GB · {r.gpu_percent === null ? "—" : r.gpu_percent === 0 ? "CPU" : `${r.gpu_percent}% GPU`}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section aria-label="GitHub" className={`${card} space-y-2 p-4`}>
          <h2 className={`${sectionTitle} flex items-center gap-1.5`}><Globe size={13} />GitHub</h2>
          <p className="text-[12.5px] leading-relaxed text-mute">{t("int.github")}</p>
        </section>

        <section aria-label={t("int.api")} className={`${card} space-y-2 p-4 xl:col-span-2`}>
          <h2 className={`${sectionTitle} flex items-center gap-1.5`}><Key size={13} />{t("int.api")}</h2>
          <p className="text-[12.5px] leading-relaxed text-mute">{t("int.apiBody")}</p>
          <a href={href("settings")} className="text-[12.5px] text-accent-ink hover:underline">{t("int.apiKeys")}</a>
        </section>
      </div>
    </div>
  );
}
