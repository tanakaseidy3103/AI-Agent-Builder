/** Public demo notice + live connection state. Rendered only in demo builds (VITE_DEMO_MODE=true). */
import { useQuery } from "@tanstack/react-query";
import { api, type DemoStatus } from "../api";
import { useT } from "../i18n";


export function DemoBanner() {
  const t = useT();
  const q = useQuery({ queryKey: ["demo-status"], queryFn: () => api<DemoStatus>("/demo/status"), refetchInterval: 30_000, retry: 1 });
  const state = q.isPending ? "checking" : q.isError ? "offline" : !q.data.model_ready ? "model" : q.data.queue >= q.data.queue_max ? "busy" : "ok";
  const tone = state === "ok" ? "border-ok/30 bg-ok/[0.06]" : state === "checking" ? "border-line bg-panel" : "border-warn/30 bg-warn/[0.08]";
  const body = q.data ? t("demo.body", { n: q.data.limits.generations_per_session, h: q.data.limits.data_ttl_hours }) : t("demo.bodyShort");
  return (
    <div role="status" aria-live="polite" data-testid="demo-banner" data-state={state}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-[12.5px] leading-snug text-ink/90 ${tone}`}>
      <span className="font-semibold">{t("demo.title")}</span>
      <span className="ml-auto font-medium sm:order-last">
        {state === "checking" && t("demo.checking")}
        {state === "offline" && t("demo.offline")}
        {state === "model" && t("demo.modelDown")}
        {state === "busy" && t("demo.busy")}
        {state === "ok" && t("demo.ready", { model: q.data!.model, queue: q.data!.queue })}
      </span>
      {/* phones: the limits fold away so the banner stays one or two lines; wider screens show them inline */}
      <span className="hidden text-mute sm:inline">{body}</span>
      <details className="w-full text-mute sm:hidden">
        <summary className="cursor-pointer select-none text-[12px]">{t("demo.details")}</summary>
        <p className="pt-1">{body}</p>
      </details>
    </div>
  );
}
