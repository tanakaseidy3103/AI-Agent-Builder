/** Create page: chat-style request on the left, Agent Office (real pipeline events) on the right, result below. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type AgentEvent, type AgentId, type FailureCategory, type Job, type VersionDetail } from "../api";
import { useLang, useT, type Key } from "../i18n";
import { Robot, type RobotState } from "./Robot";
import { useJob, VersionView } from "./SkillStudio";
import { Badge, Card, ErrorBox, inputCls, primaryBtn } from "./ui";

const TEMPLATES: Record<"en" | "ja", { title: string; prompt: string }[]> = {
  en: [
    { title: "Laravel bug finder", prompt: "Create an agent that analyzes Laravel PHP and Blade files and reports SQL built from variables in DB::select or whereRaw, protected $guarded = [], env() outside config/, leftover dd(), and POST forms without @csrf — each with file, line and rule." },
    { title: "React accessibility review", prompt: "Create an agent that finds accessibility problems in React JSX/TSX files: img without alt, clickable div or span without role or keyboard handler, and anchors without href. Report file, line and rule." },
    { title: "Python code review", prompt: "Create an agent that analyzes Python source files and reports bare except clauses, mutable default arguments and unused imports, each with file, line and rule name." },
    { title: "API test planner", prompt: "Create an agent that takes an OpenAPI 3 JSON document and produces an API test plan: one happy-path test per operation with its expected 2xx status, plus a 404 test for every path with parameters." },
  ],
  ja: [
    { title: "Laravel のバグ検出", prompt: "Laravel の PHP・Blade ファイルを解析し、DB::select や whereRaw で変数から組み立てた SQL、protected $guarded = []、config/ 以外での env()、残った dd()、@csrf のない POST フォームを、ファイル名・行番号・ルール名付きで報告するエージェントを作成してください。" },
    { title: "React のアクセシビリティ確認", prompt: "React の JSX/TSX ファイルから、alt のない img、role やキーボード操作のないクリック可能な div/span、href のないリンクを検出し、ファイル名・行番号・ルール名を報告するエージェントを作成してください。" },
    { title: "Python コードレビュー", prompt: "Python のソースファイルを解析し、bare except、ミュータブルなデフォルト引数、未使用の import を、ファイル名・行番号・ルール名付きで報告するエージェントを作成してください。" },
    { title: "API テスト計画", prompt: "OpenAPI 3 の JSON を受け取り、各オペレーションの正常系テスト（期待する 2xx ステータス付き）と、パスパラメータを持つパスごとの 404 テストからなるテスト計画を作成するエージェントを作ってください。" },
  ],
};

const ROLES: { id: AgentId; accent: string }[] = [
  { id: "architect", accent: "#8b7cff" },
  { id: "coder", accent: "#5b8dff" },
  { id: "reviewer", accent: "#6fd3c1" },
  { id: "tester", accent: "#f5a04b" },
  { id: "packager", accent: "#c08bff" },
];

const NEXT: Partial<Record<FailureCategory, Key[]>> = {
  syntax: ["next.model", "next.rephrase"], policy: ["next.rephrase", "next.model"], hallucinated_api: ["next.model", "next.rephrase"],
  entrypoint: ["next.model"], test_definition: ["next.model"], spec_error: ["next.rephrase"],
  test_failure: ["next.inspect", "next.model"], eval_failure: ["next.inspect", "next.rephrase"],
  execution_limit: ["next.inspect"], not_executable: ["next.code"],
};

interface Request { jobId: string; prompt: string; kind: string }

export function AgentStudio() {
  const t = useT();
  const [requests, setRequests] = useState<Request[]>([]);
  const [resultId, setResultId] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const current = requests[requests.length - 1];
  const job = useJob(current?.jobId ?? null);

  const openResult = (id: string) => {
    setResultId(id);
    setTimeout(() => resultRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0);
  };

  return (
    <div className="space-y-6">
      {requests.length === 0 && <Hero />}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ChatPanel requests={requests} onSubmit={(r) => { setRequests((xs) => [...xs, r]); setResultId(null); }} onOpen={openResult} />
        <AgentOffice job={current ? job.data : undefined} />
      </div>
      <div ref={resultRef}>{resultId && <VersionView id={resultId} onSelect={setResultId} />}</div>
    </div>
  );
}

function Hero() {
  const t = useT();
  return (
    <section className="overflow-hidden rounded-3xl border border-white/8 bg-gradient-to-br from-ink-850 to-ink-900 p-6 sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{t("hero.title")}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">{t("hero.body")}</p>
          <ol className="mt-5 grid gap-3 sm:grid-cols-3">
            {(["hero.step1", "hero.step2", "hero.step3"] as Key[]).map((k, i) => (
              <li key={k} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-200">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-brand/20 text-xs font-semibold text-violet-200">{i + 1}</span>
                {t(k)}
              </li>
            ))}
          </ol>
        </div>
        <div className="flex justify-center gap-1 lg:w-80" aria-hidden="true">
          <Robot accent="#8b7cff" state="idle" label="" />
          <Robot accent="#5b8dff" state="idle" label="" />
          <Robot accent="#f5a04b" state="idle" label="" />
        </div>
      </div>
    </section>
  );
}

function ChatPanel({ requests, onSubmit, onOpen }: { requests: Request[]; onSubmit: (r: Request) => void; onOpen: (id: string) => void }) {
  const t = useT();
  const { lang } = useLang();
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState("auto");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const start = useMutation({
    mutationFn: (r: { prompt: string; kind: string }) =>
      api<Job>("/studio/skills/generate", { method: "POST", body: JSON.stringify(r) }),
    onSuccess: (j, r) => { onSubmit({ jobId: j.id, ...r }); setPrompt(""); },
  });
  const tooShort = prompt.trim().length > 0 && prompt.trim().length < 10;
  return (
    <Card title={t("chat.title")} className="flex flex-col">
      <div className="space-y-4">
        {requests.length === 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{t("hero.templates")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TEMPLATES[lang].map((x) => (
                <button key={x.title} type="button"
                  onClick={() => { setPrompt(x.prompt); inputRef.current?.focus(); }}
                  className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-left text-sm text-slate-200 hover:border-violet-brand/40 hover:bg-white/[0.04]">
                  {x.title}
                </button>
              ))}
            </div>
          </div>
        )}
        <ol className="space-y-4" aria-label={t("chat.title")}>
          {requests.map((r) => <Conversation key={r.jobId} req={r} onOpen={onOpen} onRetry={() => start.mutate({ prompt: r.prompt, kind: r.kind })}
            onRefine={() => { setPrompt(`${r.prompt}

${t("chat.correction")}: `); setKind(r.kind); inputRef.current?.focus(); }} />)}
        </ol>
        <form className="space-y-3 border-t border-white/5 pt-4" onSubmit={(e) => { e.preventDefault(); start.mutate({ prompt: prompt.trim(), kind }); }}>
          <label className="block text-xs font-medium text-slate-300" htmlFor="prompt">{t("chat.label")}</label>
          <textarea id="prompt" ref={inputRef} rows={4} className={inputCls} placeholder={t("chat.placeholder")}
            value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-describedby={tooShort ? "prompt-hint" : undefined}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && prompt.trim().length >= 10) start.mutate({ prompt: prompt.trim(), kind }); }} />
          {tooShort && <p id="prompt-hint" className="text-xs text-amber-200">{t("chat.minLength")}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer select-none">{t("chat.advanced")}</summary>
              <label className="mt-2 flex items-center gap-2" htmlFor="kind">
                {t("chat.kind")}
                <select id="kind" className="rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-slate-100" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="auto">{t("chat.kind.auto")}</option>
                  <option value="instructions">{t("chat.kind.instructions")}</option>
                  <option value="code">{t("chat.kind.code")}</option>
                </select>
              </label>
            </details>
            <button type="submit" disabled={prompt.trim().length < 10 || start.isPending} className={`ml-auto ${primaryBtn}`}>
              {start.isPending ? t("chat.sending") : t("chat.send")}
            </button>
          </div>
          {start.error && <ErrorBox error={start.error} />}
        </form>
      </div>
    </Card>
  );
}

function Bubble({ who, children }: { who: "you" | "studio"; children: React.ReactNode }) {
  const t = useT();
  return (
    <li className={`flex ${who === "you" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${who === "you" ? "bg-violet-brand/20 text-violet-50" : "border border-white/8 bg-white/[0.03] text-slate-200"}`}>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{who === "you" ? t("chat.you") : t("chat.studio")}</div>
        {children}
      </div>
    </li>
  );
}

function Conversation({ req, onOpen, onRetry, onRefine }: { req: Request; onOpen: (id: string) => void; onRetry: () => void; onRefine: () => void }) {
  const t = useT();
  const job = useJob(req.jobId);
  const j = job.data;
  const vid = j?.status === "completed" ? j.skill_version_id : null;
  const version = useQuery({ queryKey: ["version", vid], queryFn: () => api<VersionDetail>(`/studio/versions/${vid}`), enabled: !!vid });
  const v = version.data;
  const cat = v?.validation?.report.failure_category;
  return (
    <>
      <Bubble who="you">{req.prompt}</Bubble>
      <Bubble who="studio">
        {job.error && <ErrorBox error={job.error} />}
        {j && <p>{t("chat.started", { provider: j.provider ?? "…" })}</p>}
        {j && (j.status === "draft" || j.status === "generating") && j.stage && (
          <p className="mt-1 text-slate-300">{t("chat.stage", { stage: j.stage })}</p>
        )}
        {j?.status === "failed" && (
          <div className="mt-2 space-y-2">
            <ErrorBox error={t("chat.jobFailed", { error: j.error ?? "" })} />
            <button type="button" className="text-xs text-blue-brand underline" onClick={onRetry}>{t("chat.retry")}</button>
          </div>
        )}
        {v && (
          <div className="mt-2 space-y-2">
            <p className="flex items-start gap-2"><Badge status={v.status} />
              <span>{t(`chat.${v.status}` as Key, { slug: v.slug, version: v.version })}</span></p>
            {cat && cat !== "none" && (
              <div className="rounded-xl border border-white/8 bg-ink-950/60 p-3 text-xs">
                <p><span className="font-semibold text-amber-200">{t("chat.why")}: </span>{t(`cat.${cat}` as Key)}</p>
                {NEXT[cat] && (
                  <>
                    <p className="mt-2 font-semibold text-slate-200">{t("chat.next")}</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-300">{NEXT[cat]!.map((k) => <li key={k}>{t(k)}</li>)}</ul>
                  </>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <button type="button" className={primaryBtn} onClick={() => onOpen(v.id)}>{t("chat.openResult")}</button>
              {v.status !== "verified" && <button type="button" className="text-xs text-blue-brand underline" onClick={onRetry}>{t("chat.retry")}</button>}
              <button type="button" className="text-xs text-blue-brand underline" onClick={onRefine}>{t("chat.refine")}</button>
            </div>
          </div>
        )}
        {j && j.stages.length > 0 && (
          <details className="mt-3 text-xs text-slate-400">
            <summary className="cursor-pointer select-none">Pipeline ({j.stages.filter((s) => s.status !== "pending").length}/{j.stages.length})</summary>
            <ol className="mt-2 space-y-1.5" aria-label="pipeline stages">
              {j.stages.map((s) => (
                <li key={s.name} className="flex items-start gap-2">
                  <span className="w-32 shrink-0 font-mono text-slate-300">{s.name}</span>
                  <Badge status={s.status} />
                  <span className="text-slate-500">{s.detail}{s.duration_ms ? ` · ${s.duration_ms} ms` : ""}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </Bubble>
    </>
  );
}

function AgentOffice({ job }: { job?: Job }) {
  const t = useT();
  const runId = job?.id;
  const live = job?.status === "draft" || job?.status === "generating";
  const events = useQuery({
    queryKey: ["events", runId],
    queryFn: () => api<AgentEvent[]>(`/studio/events?run_id=${runId}&limit=500`),
    enabled: !!runId,
    refetchInterval: live ? 1000 : false,
  });
  // one last fetch once the job settles, so the final events are not missed
  useEffect(() => { if (runId && !live) events.refetch(); }, [live, runId]); // eslint-disable-line react-hooks/exhaustive-deps
  const evs = events.data ?? [];
  // real retries: each repair round emits "generate_files: started (repair N)"
  const repairs = evs.filter((e) => e.agent_id === "coder" && /started \(repair \d+\)/.test(e.message ?? "")).length;
  const stateOf = useMemo(() => {
    const m = new Map<AgentId, RobotState>();
    for (const e of evs) m.set(e.agent_id, (e.state as RobotState) ?? "idle");
    return m;
  }, [evs]);
  return (
    <Card title={t("office.title")} actions={job ? <Badge status={job.status} /> : undefined}>
      <p className="mb-4 text-xs text-slate-400">{t("office.subtitle")}</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label={t("office.title")}>
        {ROLES.map((r) => {
          const s: RobotState = stateOf.get(r.id) ?? "waiting";
          const name = t(`role.${r.id}` as Key);
          return (
            <li key={r.id} data-testid={`robot-${r.id}`} data-state={s}
              className={`flex flex-col items-center rounded-2xl border p-3 text-center transition-colors ${s === "failed" ? "border-rose-400/30 bg-rose-500/5" : s === "waiting" ? "border-white/5" : "border-white/10 bg-white/[0.03]"}`}>
              <Robot accent={r.accent} state={s} label={`${name}: ${t(`state.${s}` as Key)}`} />
              <span className="mt-1 text-sm font-semibold text-slate-100">{name}</span>
              <span className="text-[11px] text-slate-400">{t(`role.${r.id}.does` as Key)}</span>
              {r.id === "coder" && repairs > 0 && <span className="text-[11px] text-amber-200">{t("office.repairs", { n: repairs })}</span>}
              <span className="mt-1 text-[11px] font-medium" style={{ color: s === "waiting" ? "#6b7699" : r.accent }}>{t(`state.${s}` as Key)}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-slate-500">{t("office.planned")}: {t("role.researcher")}, {t("role.security")}</p>
      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">{t("office.activity")}</h3>
      {!runId ? <p className="text-sm text-slate-500">{t("office.idle")}</p> : evs.length === 0 ? (
        <p className="text-sm text-slate-500">{t("office.noActivity")}</p>
      ) : (
        <ol aria-live="polite" aria-label={t("office.activity")} className="max-h-72 space-y-1.5 overflow-y-auto pr-1 font-mono text-xs">
          {[...evs].reverse().slice(0, 40).map((e) => (
            <li key={e.id} className="flex gap-2 text-slate-300">
              <time className="shrink-0 text-slate-500" dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time>
              <span className="shrink-0 font-semibold" style={{ color: ROLES.find((r) => r.id === e.agent_id)?.accent }}>{t(`role.${e.agent_id}` as Key)}</span>
              <span className={e.state === "failed" ? "text-rose-300" : ""}>{e.message}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
