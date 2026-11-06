import { useState, type ReactNode } from "react";
import { useT } from "../i18n";

const OK = "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30";
const BAD = "bg-rose-400/10 text-rose-300 ring-rose-400/30";
const WARN = "bg-amber-400/10 text-amber-200 ring-amber-400/30";
const MUTED = "bg-white/5 text-slate-400 ring-white/10";

const STATUS_STYLE: Record<string, string> = {
  verified: OK, passed: OK, pass: OK, completed: OK,
  validated: "bg-sky-400/10 text-sky-300 ring-sky-400/30",
  validation_failed: WARN, warn: WARN,
  failed: BAD, fail: BAD, error: BAD,
  running: "bg-violet-400/15 text-violet-200 ring-violet-400/40 animate-pulse",
  generating: "bg-violet-400/15 text-violet-200 ring-violet-400/40 animate-pulse",
  draft: MUTED, skipped: MUTED, skip: MUTED, pending: "bg-transparent text-slate-500 ring-white/10",
};

export function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status] ?? STATUS_STYLE.pending}`}>
      {status}
    </span>
  );
}

export function Card({ title, actions, children, className = "" }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/8 bg-ink-900/80 shadow-lg shadow-black/20 backdrop-blur ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-3.5">
        <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function CopyBlock({ label, text }: { label: string; text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-blue-brand hover:bg-white/5"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-white/5 bg-ink-950 p-3 font-mono text-xs text-slate-200">{text}</pre>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

export const inputCls =
  "w-full rounded-xl border border-white/10 bg-ink-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-brand/60 focus:outline-none";
export const primaryBtn =
  "rounded-xl bg-violet-brand px-4 py-2 text-sm font-semibold text-white shadow-md shadow-violet-900/40 hover:bg-violet-brand/90 disabled:cursor-not-allowed disabled:opacity-40";
export const ghostBtn = "rounded-xl border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40";
