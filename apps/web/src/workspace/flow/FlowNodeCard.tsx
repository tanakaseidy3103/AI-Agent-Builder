/** One step of the Skill Flow as a keyboard-accessible button. Shows only what the derived node carries. */
import type { ReactNode } from "react";
import { useT, type Key } from "../../i18n";
import { Alert, Check, Chip, CodeI, Cube, Download, FileI, Flask, Folder, Plug, Send, Shield, Wrench } from "../icons";
import { Pill, type Tone } from "../kit";
import type { FlowNode, NodeKind, NodeState, Source } from "./types";

type T = ReturnType<typeof useT>;

export const KIND_ICON: Record<NodeKind, (p: { size?: number; className?: string }) => ReactNode> = {
  input: Plug, validation: Shield, runner: Send, execution: Chip, function: CodeI, dependencies: Cube, output: Download,
  instructions: FileI, evaluation: Flask, tests: Check, checks: Wrench, docs: Folder,
};

/** Stripe colour by role: data in/out, platform, code, verification, documentation. */
const KIND_STRIPE: Record<NodeKind, string> = {
  input: "border-l-info", output: "border-l-info",
  validation: "border-l-warn",
  execution: "border-l-accent", function: "border-l-accent", runner: "border-l-accent", dependencies: "border-l-accent",
  tests: "border-l-ok", evaluation: "border-l-ok", checks: "border-l-ok",
  docs: "border-l-line-strong", instructions: "border-l-line-strong",
};

export const STATE_TONE: Record<NodeState, Tone> = {
  passed: "ok", failed: "bad", not_executed: "mute", missing: "warn", unspecified: "warn", info: "mute",
};

export const SOURCE_STYLE: Record<Source, string> = {
  executed: "text-ok", static: "text-info", scanned: "text-warn", manifest: "text-mute", platform: "text-mute",
};

export const nodeLabel = (t: T, n: FlowNode) => n.title ?? t(`sf.kind.${n.kind}` as Key);

/** A short line from the node's own data: counts of fields, results or functions. Never an estimate. */
export function nodeSummary(t: T, n: FlowNode): string | null {
  const results = n.results.filter((r) => r.source !== "static" || n.kind === "checks");
  switch (n.kind) {
    case "input": case "output": {
      const props = n.facts.filter((f) => f.key === "property").length;
      return props ? t("sf.sum.props", { n: props }) : null;
    }
    case "tests": case "evaluation": {
      const run = results.filter((r) => r.status !== "not_executed");
      if (!results.length) return null;
      return run.length ? t("sf.sum.results", { p: run.filter((r) => r.status === "pass").length, n: results.length }) : t("sf.state.not_executed");
    }
    case "checks":
      return n.results.length ? t("sf.sum.checks", { f: n.results.filter((r) => r.status === "fail").length, n: n.results.length }) : null;
    case "execution": {
      const fc = n.facts.find((f) => f.key === "function_count");
      return fc ? t("sf.sum.functions", { n: fc.value }) : null;
    }
    case "dependencies": {
      const imports = n.facts.filter((f) => f.key === "import").length;
      return imports ? t("sf.sum.imports", { n: imports }) : null;
    }
    case "docs": return t("sf.sum.files", { n: n.refs.length });
    case "function": return n.facts.find((f) => f.key === "params")?.value ? `(${n.facts.find((f) => f.key === "params")!.value})` : "()";
    case "instructions": {
      const steps = n.facts.find((f) => f.key === "steps");
      return steps ? t("sf.sum.steps", { n: steps.value }) : null;
    }
    default: return null;
  }
}

export function FlowNodeCard({ node, selected, onSelect, compact = false }: {
  node: FlowNode; selected: boolean; onSelect: (id: string) => void; compact?: boolean;
}) {
  const t = useT();
  const Icon = KIND_ICON[node.kind];
  const summary = nodeSummary(t, node);
  const kindLabel = t(`sf.kind.${node.kind}` as Key);
  const state = t(`sf.state.${node.state}` as Key);
  return (
    <button type="button" data-node={node.id} data-kind={node.kind} data-state={node.state} data-source={node.source}
      aria-pressed={selected} aria-controls="sf-detail"
      aria-label={`${kindLabel}${node.title ? `: ${node.title}` : ""}. ${state}. ${t(`sf.source.${node.source}` as Key)}`}
      onClick={() => onSelect(node.id)}
      className={`relative block w-full min-w-0 rounded-md border border-l-[3px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-canvas ${KIND_STRIPE[node.kind]} ${compact ? "px-2 py-1.5" : "px-2.5 py-2"} ${selected ? "border-accent/70 bg-accent/[0.07] shadow-sm" : "border-line bg-panel hover:border-line-strong hover:bg-hover"} ${node.state === "missing" ? "border-dashed" : ""}`}>
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon size={13} className="shrink-0 text-mute" />
        <span className={`min-w-0 flex-1 truncate ${compact ? "font-mono text-[12px] text-ink" : "text-[12.5px] font-medium text-ink"}`}>
          {compact ? node.title ?? kindLabel : kindLabel}
        </span>
        {node.state !== "info" && <Pill tone={STATE_TONE[node.state]}>{node.state === "failed" && <Alert size={10} />}{state}</Pill>}
      </span>
      {!compact && node.title && <span className="mt-0.5 block truncate font-mono text-[11.5px] text-mute">{node.title}</span>}
      <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px]">
        {summary && <span className="truncate text-mute">{summary}</span>}
        <span className={`ml-auto shrink-0 ${SOURCE_STYLE[node.source]}`}>{t(`sf.source.${node.source}` as Key)}</span>
      </span>
    </button>
  );
}
