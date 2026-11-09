/** Center: the request conversation, the real plan, the live pipeline and the outcome. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type FailureCategory, type Job, type Models, type VersionDetail } from "../api";
import { useLang, useT, type Key } from "../i18n";
import { useJob } from "./hooks";
import { Pencil, Retry, Send, Spark } from "./icons";
import { Button, ErrorNote, StatusPill, field, sectionTitle } from "./kit";
import { PlanReview, type PlanOut } from "./PlanReview";
import { UseAgent } from "./UseAgent";
import { JOURNEY } from "./agents";
import type { Draft } from "../pages/Studio";

export interface Request { jobId: string; prompt: string; kind: string; model?: string }

const SAMPLES: Record<"en" | "ja", { title: string; prompt: string }[]> = {
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

const NEXT: Partial<Record<FailureCategory, Key[]>> = {
  syntax: ["next.model", "next.rephrase"], policy: ["next.rephrase", "next.model"], hallucinated_api: ["next.model", "next.rephrase"],
  unsafe_instructions: ["next.rephrase"], secrets: ["next.rephrase"], entrypoint: ["next.model"], test_definition: ["next.model"], spec_error: ["next.rephrase"],
  test_failure: ["next.inspect", "next.model"], eval_failure: ["next.inspect", "next.rephrase"], execution_limit: ["next.inspect"],
  not_executable: ["next.code"],
};

export function Session({ requests, onSubmit, onOpen, openId, draft, onAwaitingApproval }: {
  requests: Request[]; onSubmit: (r: Request) => void; onOpen: (versionId: string, reveal?: boolean) => void; openId: string | null;
  draft?: Draft; onAwaitingApproval?: (waiting: boolean) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState("auto");
  const [model, setModel] = useState("");  // "" = server default
  const models = useQuery({ queryKey: ["models"], queryFn: () => api<Models>("/studio/models"), staleTime: Infinity });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [reviewFirst, setReviewFirst] = useState(false);
  type Ask = { prompt: string; kind: string; model?: string };
  const [pending, setPending] = useState<(PlanOut & { ask: Ask }) | null>(null);
  const start = useMutation({
    mutationFn: (r: Ask & { spec?: PlanOut["spec"] }) => api<Job>("/studio/skills/generate", { method: "POST", body: JSON.stringify(r) }),
    onSuccess: (j, r) => { onSubmit({ jobId: j.id, prompt: r.prompt, kind: r.kind, model: r.model }); setPrompt(""); setPending(null); },
  });
  const planner = useMutation({
    mutationFn: (r: Ask) => api<PlanOut>("/studio/skills/plan", { method: "POST", body: JSON.stringify(r) }),
    onSuccess: (p, ask) => setPending({ ...p, ask }),
  });
  useEffect(() => { onAwaitingApproval?.(!!pending); }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (draft) { setPrompt(draft.text); inputRef.current?.focus(); } }, [draft?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" }); }, [requests.length, !!pending]);
  const busy = start.isPending || planner.isPending;
  const submit = () => {
    if (prompt.trim().length < 10 || busy) return;
    const ask = { prompt: prompt.trim(), kind, model: model || undefined };
    if (reviewFirst) planner.mutate(ask);
    else start.mutate(ask);
  };
  const tooShort = prompt.trim().length > 0 && prompt.trim().length < 10;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
          {requests.length === 0 && (
            <section className="space-y-6 pt-6 sm:pt-14">
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-accent-ink"><Spark size={13} />{t("ws.kicker")}</p>
                <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{t("ws.title")}</h1>
                <p className="max-w-2xl text-sm leading-relaxed text-mute">{t("ws.body")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3" aria-label={t("flow.title")}>
                {([["hero.step1", "1"], ["hero.step2", "2"], ["hero.step3", "3"]] as [Key, string][]).map(([k, n]) => (
                  <div key={k} className="flex items-start gap-2.5 rounded-lg border border-line bg-panel px-3.5 py-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold text-accent-ink">{n}</span>
                    <span className="text-[12.5px] leading-snug text-ink">{t(k)}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className={`${sectionTitle} mb-2`}>{t("hero.templates")}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SAMPLES[lang].map((x) => (
                    <button key={x.title} type="button" onClick={() => { setPrompt(x.prompt); inputRef.current?.focus(); }}
                      className="group rounded-md border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-raised">
                      <span className="block text-[13px] font-medium text-ink">{x.title}</span>
                      <span className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-mute">{x.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
          <ol className="space-y-8" aria-label={t("chat.title")}>
            {requests.map((r) => (
              <Turn key={r.jobId} req={r} onOpen={onOpen} openId={openId}
                onRetry={() => start.mutate({ prompt: r.prompt, kind: r.kind, model: r.model })}
                onRefine={() => { setPrompt(`${r.prompt}\n\n${t("chat.correction")}: `); setKind(r.kind); inputRef.current?.focus(); }} />
            ))}
          </ol>
          {planner.isPending && <p className="text-sm text-mute" role="status">{t("plan.loading")}</p>}
          {pending && <PlanReview key={pending.preview.slug + pending.ask.prompt} plan={pending} busy={start.isPending}
            onApprove={(spec) => start.mutate({ ...pending.ask, spec })} onReject={() => setPending(null)} />}
          <div ref={endRef} />
        </div>
      </div>

      <form className="border-t border-line bg-panel/80 backdrop-blur" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="mx-auto w-full max-w-3xl space-y-2 px-4 py-3 sm:px-6">
          <label htmlFor="prompt" className="sr-only">{t("chat.label")}</label>
          <div className="rounded-xl border border-line bg-canvas shadow-sm transition-colors focus-within:border-accent/60 focus-within:shadow-md">
            <textarea id="prompt" ref={inputRef} rows={3} value={prompt} placeholder={t("chat.placeholder")}
              aria-describedby={tooShort ? "prompt-hint" : "prompt-help"}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
              className="block w-full resize-none bg-transparent px-3 pt-2.5 text-sm text-ink placeholder:text-faint focus:outline-none" />
            <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
              <label htmlFor="model" className="sr-only">{t("chat.model")}</label>
              <select id="model" value={model} onChange={(e) => setModel(e.target.value)} disabled={!models.data?.installed.length}
                title={models.data?.error ?? t("chat.model")}
                className="h-7 max-w-[11rem] rounded-md border border-line bg-raised px-1.5 font-mono text-[11.5px] text-mute focus:border-accent/60 focus:outline-none">
                <option value="">{models.data ? `${models.data.default} · ${t("chat.modelDefault")}` : t("chat.model")}</option>
                {models.data?.installed.filter((m) => m !== models.data!.default).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <span id="prompt-help" className="hidden text-[11px] text-faint sm:inline">{t("ws.shortcut")}</span>
              <Button type="submit" variant="primary" size="sm" className="ml-auto" disabled={prompt.trim().length < 10 || busy || !!pending}>
                <Send size={13} />{busy ? t("chat.sending") : reviewFirst ? t("plan.propose") : t("chat.send")}
              </Button>
            </div>
          </div>
          <details className="group text-xs">
            <summary className="cursor-pointer select-none text-mute hover:text-ink">{t("chat.advanced")}</summary>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-2">
                <label htmlFor="kind" className="text-mute">{t("chat.kind")}</label>
                <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}
                  className="h-7 rounded-md border border-line bg-raised px-1.5 text-xs text-ink focus:border-accent/60 focus:outline-none">
                  <option value="auto">{t("chat.kind.auto")}</option>
                  <option value="instructions">{t("chat.kind.instructions")}</option>
                  <option value="code">{t("chat.kind.code")}</option>
                </select>
              </span>
              <label className="flex items-center gap-2 text-ink">
                <input type="checkbox" className="accent-[var(--color-accent)]" checked={reviewFirst} onChange={(e) => setReviewFirst(e.target.checked)} />
                {t("plan.reviewFirst")}
              </label>
            </div>
          </details>
          {tooShort && <p id="prompt-hint" className="text-xs text-warn">{t("chat.minLength")}</p>}
          {start.error && <ErrorNote error={start.error} />}
          {planner.error && <ErrorNote error={planner.error} />}
        </div>
      </form>
    </div>
  );
}

function Turn({ req, onOpen, onRetry, onRefine, openId }: { req: Request; onOpen: (id: string, reveal?: boolean) => void; onRetry: () => void; onRefine: () => void; openId: string | null }) {
  const t = useT();
  const job = useJob(req.jobId, true); // the turn owns its job's polling
  const j = job.data;
  const vid = j?.status === "completed" ? j.skill_version_id : null;
  const version = useQuery({ queryKey: ["version", vid], queryFn: () => api<VersionDetail>(`/studio/versions/${vid}`), enabled: !!vid });
  const v = version.data;
  const cat = v?.validation?.report.failure_category;
  // open the result automatically once, so the inspector follows the newest finished request
  useEffect(() => { if (v && openId !== v.id) onOpen(v.id); }, [v?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const stage = (n: string) => j?.stages.find((s) => s.name === n);
  const plan = [stage("analyze"), stage("specify"), stage("plan")].filter((s) => s && s.status === "passed" && s.detail);

  return (
    <li className="space-y-3">
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-raised px-3.5 py-2.5 text-sm text-ink ring-1 ring-inset ring-line">{req.prompt}</p>
      </div>
      <div className="space-y-3">
        {job.error && <ErrorNote error={job.error} />}
        {j && <p className="text-sm text-mute">{t("chat.started", { provider: j.provider ?? "…" })}</p>}
        {plan.length > 0 && (
          <section className="rounded-lg border border-line bg-panel px-4 py-3" aria-label={t("ws.plan")}>
            <h3 className={`${sectionTitle} mb-1.5`}>{t("ws.plan")}</h3>
            <dl className="space-y-1 text-[12.5px]">
              {plan.map((s) => (
                <div key={s!.name} className="flex gap-3"><dt className="w-16 shrink-0 font-mono text-faint">{s!.name}</dt><dd className="break-words text-ink/85">{s!.detail}</dd></div>
              ))}
            </dl>
          </section>
        )}
        {j?.status === "failed" && (
          <div className="space-y-2">
            <ErrorNote error={t("chat.jobFailed", { error: j.error ?? "" })} />
            <Button size="sm" onClick={onRetry}><Retry size={13} />{t("chat.retry")}</Button>
          </div>
        )}
        {v && (
          <section className="space-y-3 rounded-lg border border-line bg-panel px-4 py-3" aria-label={t("ws.outcome")}>
            <p className="flex items-start gap-2 text-sm text-ink"><StatusPill status={v.status} /><span>{t(`chat.${v.status}` as Key, { slug: v.slug, version: v.version })}</span></p>
            {cat && cat !== "none" && (
              <div className="space-y-1.5 text-[12.5px]">
                <p><span className="font-medium text-warn">{t("chat.why")}: </span><span className="text-ink/85">{t(`cat.${cat}` as Key)}</span></p>
                {NEXT[cat] && (
                  <>
                    <p className="font-medium text-ink">{t("chat.next")}</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-mute">{NEXT[cat]!.map((k) => <li key={k}>{t(k)}</li>)}</ul>
                  </>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => onOpen(v.id, true)}>{t("chat.openResult")}</Button>
              <Button size="sm" onClick={onRefine}><Pencil size={13} />{t("chat.refine")}</Button>
              {v.status !== "verified" && <Button size="sm" variant="quiet" onClick={onRetry}><Retry size={13} />{t("chat.retry")}</Button>}
            </div>
            <UseAgent v={v} onView={() => onOpen(v.id, true)} />
          </section>
        )}
      </div>
    </li>
  );
}
