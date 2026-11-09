/** Workspace primitives: status marks, pills, buttons, tabs, code, empty/error states. */
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useT, type Key } from "../i18n";
import { highlightLine, langOf } from "./highlight";
import { Alert, Check, Clock, Cross } from "./icons";

export type Tone = "ok" | "bad" | "warn" | "info" | "accent" | "mute";

const TONE: Record<Tone, string> = {
  ok: "text-ok bg-ok/10 ring-ok/25",
  bad: "text-bad bg-bad/10 ring-bad/25",
  warn: "text-warn bg-warn/10 ring-warn/25",
  info: "text-info bg-info/10 ring-info/25",
  accent: "text-accent-ink bg-accent/12 ring-accent/30",
  mute: "text-mute bg-white/[0.03] ring-line",
};

export function toneOf(status?: string | null): Tone {
  switch (status) {
    case "verified": case "passed": case "pass": return "ok";
    case "completed": return "mute"; // a finished job is not a successful agent: only the agent's own result gets a colour
    case "validated": return "info";
    case "validation_failed": case "warn": return "warn";
    case "failed": case "fail": case "error": return "bad";
    case "running": case "generating": case "planning": case "working": case "testing": return "accent";
    default: return "mute";
  }
}

export function Pill({ tone = "mute", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium ring-1 ring-inset ${TONE[tone]}`}>
      {children}
    </span>
  );
}

const LABELLED = new Set(["verified", "validated", "validation_failed", "completed", "generating", "draft", "failed", "running", "passed"]);

/** Plain-language status label; the raw backend status stays in data-status (and in the tooltip). */
export function StatusPill({ status }: { status: string }) {
  const t = useT();
  return (
    <span data-status={status} className="inline-flex">
      <Pill tone={toneOf(status)} title={status}>{LABELLED.has(status) ? t(`st.${status}` as Key) : status}</Pill>
    </span>
  );
}

/** Stage/step mark. Animates only for a real `running` state. */
export function StepMark({ status }: { status: string }) {
  const base = "grid h-5 w-5 shrink-0 place-items-center rounded-full ring-1 ring-inset";
  if (status === "passed" || status === "pass") return <span className={`${base} bg-ok/12 text-ok ring-ok/30`}><Check size={12} /></span>;
  if (status === "failed" || status === "fail" || status === "error") return <span className={`${base} bg-bad/12 text-bad ring-bad/30`}><Cross size={11} /></span>;
  if (status === "running") return <span className={`${base} bg-accent/15 ring-accent/40`}><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /></span>;
  if (status === "skipped") return <span className={`${base} text-faint ring-line`}><span className="h-px w-2 bg-current" /></span>;
  return <span className={`${base} text-faint ring-line`}><Clock size={11} /></span>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "quiet"; size?: "sm" | "md" };

export function Button({ variant = "ghost", size = "md", className = "", ...rest }: BtnProps) {
  const v = {
    primary: "bg-accent text-white hover:bg-accent/90 shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset]",
    ghost: "border border-line bg-raised text-ink hover:bg-hover hover:border-line-strong",
    quiet: "text-mute hover:bg-hover hover:text-ink",
  }[variant];
  const s = size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm";
  return <button type="button" className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${v} ${s} ${className}`} {...rest} />;
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-0.5 overflow-x-auto border-b border-line px-3">
      {items.map((it) => (
        <button key={it.id} type="button" role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}
          className={`relative h-9 whitespace-nowrap px-2.5 text-[13px] transition-colors ${value === it.id ? "text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-px after:bg-accent" : "text-mute hover:text-ink"}`}>
          {it.label}{it.count !== undefined && <span className="ml-1.5 text-faint">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

const TOKEN: Record<string, string> = { kw: "text-accent-ink", str: "text-ok/90", com: "italic text-faint", num: "text-warn", key: "text-info", fn: "text-ink" };
const MAX_LINES = 3000; // larger files stay readable and the page stays responsive; the full file is in the download

export function Code({ text, label, lineNumbers = false, path, marks }: {
  text: string; label?: string; lineNumbers?: boolean; path?: string; marks?: Set<number>;
}) {
  const t = useT();
  const all = text.replace(/\n$/, "").split("\n");
  const lines = all.slice(0, MAX_LINES);
  const lang = path ? langOf(path) : "text";
  return (
    <pre aria-label={label} className="overflow-auto font-mono text-[12.5px] leading-[1.65] text-ink/90">
      {lineNumbers ? lines.map((l, i) => (
        <div key={i} className={`flex ${marks?.has(i + 1) ? "bg-bad/10" : ""}`} data-line={i + 1}>
          <span className={`w-10 shrink-0 select-none pr-3 text-right ${marks?.has(i + 1) ? "text-bad" : "text-faint"}`}>{i + 1}</span>
          <span className="whitespace-pre">{l ? highlightLine(l, lang).map((tk, k) => <span key={k} className={tk.kind ? TOKEN[tk.kind] : undefined}>{tk.text}</span>) : " "}</span>
        </div>
      )) : text}
      {all.length > MAX_LINES && <div className="px-3 pt-2 font-sans text-xs text-warn">{t("code.truncated", { shown: MAX_LINES, total: all.length })}</div>}
    </pre>
  );
}

/** Copies text produced on click (so large content is only fetched when asked for). */
export function CopyButton({ getText, label, disabled, title }: { getText: () => string | Promise<string>; label?: string; disabled?: boolean; title?: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  return (
    <button type="button" disabled={disabled} title={title}
      className="inline-flex min-h-6 items-center rounded px-1.5 text-accent-ink hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
      onClick={async () => {
        try { await navigator.clipboard.writeText(await getText()); setState("copied"); } catch { setState("error"); }
        setTimeout(() => setState("idle"), 1500);
      }}>
      <span aria-live="polite">{state === "copied" ? t("copied") : state === "error" ? t("copyFailed") : label ?? t("copy")}</span>
    </button>
  );
}

export function CopyField({ label, text }: { label: string; text: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-canvas">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px] text-mute">
        <span>{label}</span>
        <CopyButton getText={() => text} />
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs text-ink/90">{text}</pre>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-bad/25 bg-bad/8 px-3 py-2 text-sm text-bad">
      <Alert size={14} className="mt-0.5 shrink-0" /><span className="text-ink/90">{error instanceof Error ? error.message : String(error)}</span>
    </p>
  );
}

export function Empty({ icon, title, body, children }: { icon?: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-raised text-mute">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {body && <p className="max-w-xs text-xs leading-relaxed text-mute">{body}</p>}
      {children}
    </div>
  );
}

export const field = "w-full rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-faint transition-colors focus:border-accent/60 focus:outline-none";
export const sectionTitle = "text-[11px] font-semibold uppercase tracking-[0.08em] text-faint";

export function PageHeader({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 pb-4 pt-5 sm:px-6">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        {body && <p className="mt-0.5 max-w-2xl text-[13px] text-mute">{body}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  );
}

export const card = "rounded-lg border border-line bg-panel";
