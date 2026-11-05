import { useState, type ReactNode } from "react";
import type { StageStatus, VersionStatus } from "../api";

const STATUS_STYLE: Record<string, string> = {
  verified: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  validated: "bg-sky-100 text-sky-800 ring-sky-600/20",
  generated: "bg-amber-100 text-amber-800 ring-amber-600/20",
  passed: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  pass: "bg-emerald-100 text-emerald-800 ring-emerald-600/20",
  failed: "bg-rose-100 text-rose-800 ring-rose-600/20",
  fail: "bg-rose-100 text-rose-800 ring-rose-600/20",
  error: "bg-rose-100 text-rose-800 ring-rose-600/20",
  warn: "bg-amber-100 text-amber-800 ring-amber-600/20",
  running: "bg-indigo-100 text-indigo-800 ring-indigo-600/20 animate-pulse",
  skipped: "bg-slate-100 text-slate-600 ring-slate-500/20",
  skip: "bg-slate-100 text-slate-600 ring-slate-500/20",
  pending: "bg-white text-slate-400 ring-slate-300",
};

export const STATUS_HELP: Record<VersionStatus, string> = {
  generated: "Produced by the model; failed static validation. Not exportable.",
  validated: "Static checks passed. Code (if any) was not proven by tests.",
  verified: "Static checks passed and generated tests passed in the isolated sandbox.",
};

export function Badge({ status }: { status: StageStatus | VersionStatus | string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status] ?? STATUS_STYLE.pending}`}>
      {status}
    </span>
  );
}

export function Card({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <button
          type="button"
          className="rounded px-2 py-0.5 text-indigo-700 hover:bg-indigo-50"
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
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{text}</pre>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
