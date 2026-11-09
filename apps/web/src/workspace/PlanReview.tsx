/** Human approval before generation: the model's real plan (POST /studio/skills/plan), editable, then approve or reject. */
import { useState } from "react";
import { useT } from "../i18n";
import { Check, Cross } from "./icons";
import { Button, Code, Pill, field, sectionTitle } from "./kit";

export interface PlanOut {
  spec: Record<string, unknown> & { instructions?: string; description?: string; tools?: string[] };
  preview: { slug: string; kind: string; name: string; permissions: string[]; tools: string[]; files: string[];
    input_schema: object; output_schema: object; warnings: string[] };
  provider: string;
}

export function PlanReview({ plan, busy, onApprove, onReject }: {
  plan: PlanOut; busy: boolean; onApprove: (spec: PlanOut["spec"]) => void; onReject: () => void;
}) {
  const t = useT();
  const p = plan.preview;
  const [description, setDescription] = useState(String(plan.spec.description ?? ""));
  const [instructions, setInstructions] = useState(String(plan.spec.instructions ?? ""));
  const [tools, setTools] = useState<string[]>(p.tools);  // tools can only be removed: least privilege

  return (
    <section aria-label={t("plan.title")} data-testid="plan-review" className="space-y-4 rounded-lg border border-accent/30 bg-panel px-4 py-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{t("plan.title")}</h3>
        <Pill tone="warn">{t("plan.awaiting")}</Pill>
        <span className="ml-auto font-mono text-[11px] text-faint">{p.slug} · {p.kind} · {plan.provider}</span>
      </header>
      <p className="text-xs text-mute">{t("plan.body")}</p>
      {p.warnings.map((w) => <p key={w} className="rounded-md bg-warn/8 px-3 py-2 text-xs text-warn">{w}</p>)}

      <div className="space-y-1">
        <label htmlFor="plan-description" className={sectionTitle}>{t("plan.description")}</label>
        <input id="plan-description" className={field} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor="plan-instructions" className={sectionTitle}>{t("plan.instructions")}</label>
        <textarea id="plan-instructions" rows={5} className={`${field} resize-y font-mono text-[12.5px]`} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </div>
      <fieldset className="space-y-1.5">
        <legend className={sectionTitle}>{t("plan.tools")}</legend>
        {p.tools.length === 0 ? <p className="text-xs text-faint">{t("plan.noTools")}</p> : (
          <div className="flex flex-wrap gap-3">
            {p.tools.map((tool) => (
              <label key={tool} className="flex items-center gap-1.5 text-[12.5px] text-ink">
                <input type="checkbox" className="accent-[var(--color-accent)]" checked={tools.includes(tool)}
                  onChange={(e) => setTools(e.target.checked ? [...tools, tool] : tools.filter((x) => x !== tool))} />
                <span className="font-mono">{tool}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-mute">{t("plan.permissions")}:</span>{p.permissions.map((x) => <Pill key={x}>{x}</Pill>)}
      </div>
      <details className="rounded-md border border-line">
        <summary className="cursor-pointer px-3 py-2 text-xs text-mute hover:text-ink">{t("plan.behavior")} · {t("plan.files", { n: p.files.length })}</summary>
        <div className="space-y-2 px-3 pb-3">
          <p className="font-mono text-[11.5px] text-mute">{p.files.join(", ")}</p>
          <p className={sectionTitle}>input_schema</p><Code text={JSON.stringify(p.input_schema, null, 2)} />
          <p className={sectionTitle}>output_schema</p><Code text={JSON.stringify(p.output_schema, null, 2)} />
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || instructions.trim().length === 0}
          onClick={() => onApprove({ ...plan.spec, description, instructions, tools })}>
          <Check size={13} />{t("plan.approve")}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onReject}><Cross size={12} />{t("plan.reject")}</Button>
      </div>
    </section>
  );
}
