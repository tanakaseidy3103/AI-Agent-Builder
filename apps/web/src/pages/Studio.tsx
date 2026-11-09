/** Agent Studio: Agent Office on top, the request conversation below, the selected agent or result on the right. */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type AgentId, type VersionDetail } from "../api";
import { useT, type Key } from "../i18n";
import { AgentPanel } from "../workspace/AgentPanel";
import { agentViews, botState, turns } from "../workspace/agents";
import { StudioBot } from "../workspace/StudioBot";
import { useJob } from "../workspace/hooks";
import { Inspector } from "../workspace/Inspector";
import { OfficeStage, useRunEvents } from "../workspace/Office";
import { Session, type Request } from "../workspace/Session";

type Pane = "session" | "result";
type RightView = "agent" | "result";
export interface Draft { text: string; n: number }

// A reload during a run must not lose the conversation: keep its job ids (this tab only); all data is re-fetched live.
const KEY = "aab.studio.requests";
function loadRequests(): Request[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function saveRequests(r: Request[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(r.slice(-20))); } catch { /* storage blocked: reload starts fresh */ }
}
export function clearStudioSession() { saveRequests([]); }

export function Studio({ draft, resetKey }: { draft?: Draft; resetKey: number }) {
  return <StudioInner key={resetKey} draft={draft} />; // "New agent" remounts: empty conversation, fresh state
}

function StudioInner({ draft }: { draft?: Draft }) {
  const t = useT();
  const [pane, setPane] = useState<Pane>("session");
  const [requests, setRequests] = useState<Request[]>(loadRequests);
  useEffect(() => { saveRequests(requests); }, [requests]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<RightView>("agent");
  const [picked, setPicked] = useState<AgentId | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  // the Office follows the newest request of this session
  const job = useJob(requests.at(-1)?.jobId ?? null).data;
  const events = useRunEvents(job);
  // selected agent: the user's pick, else whoever is working now, else whoever acted last
  const role: AgentId = picked ?? agentViews(job, events).find((a) => a.state === "working")?.id ?? turns(events).at(-1)?.role ?? "architect";
  const rightView = job ? view : "result";
  // same query key as the conversation turn: read from the shared cache, no extra request
  const vid = job?.status === "completed" ? job.skill_version_id : null;
  const version = useQuery({ queryKey: ["version", vid], queryFn: () => api<VersionDetail>(`/studio/versions/${vid}`), enabled: !!vid });

  const open = (id: string, reveal = false) => { setOpenId(id); setView("result"); if (reveal) setPane("result"); };
  const selectAgent = (r: AgentId) => { setPicked(r); setView("agent"); setPane("result"); };
  const show = (p: Pane) => (pane === p ? "flex" : "hidden");

  return (
    <div className="flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,36%)]">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-2 lg:hidden" role="group" aria-label={t("ws.panes")}>
        {(["session", "result"] as Pane[]).map((p) => (
          <button key={p} type="button" aria-pressed={pane === p} onClick={() => setPane(p)}
            className={`relative h-7 flex-1 rounded-md text-[13px] ${pane === p ? "bg-hover text-ink" : "text-mute hover:text-ink"}`}>
            {t(`ws.pane.${p}` as Key)}
            {p === "result" && openId && pane !== "result" && <span aria-hidden="true" className="absolute right-3 top-2 h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      <section aria-label={t("nav.studio")} className={`${show("session")} min-h-0 flex-1 flex-col lg:flex`}>
        <OfficeStage job={job} selected={job && rightView === "agent" ? role : null} onSelect={selectAgent} awaitingApproval={awaitingApproval} />
        <div className="min-h-0 flex-1">
          <Session requests={requests} openId={openId} onOpen={open} draft={draft} onAwaitingApproval={setAwaitingApproval}
            onSubmit={(r) => { setRequests((rs) => [...rs, r]); setPicked(null); setView("agent"); }} />
        </div>
      </section>

      <aside aria-label={t("ws.pane.result")} className={`${show("result")} min-h-0 flex-1 flex-col border-line bg-panel lg:flex lg:border-l`}>
        <StudioBot job={job} state={botState(job, version.data?.status)} versionStatus={version.data?.status} awaitingApproval={awaitingApproval} />
        {job && (
          <div role="tablist" aria-label={t("ws.panes")} className="flex shrink-0 gap-1 border-b border-line px-3 py-2">
            {(["agent", "result"] as RightView[]).map((x) => (
              <button key={x} type="button" role="tab" aria-selected={rightView === x} onClick={() => setView(x)}
                className={`h-7 rounded-md px-2.5 text-[12.5px] ${rightView === x ? "bg-hover text-ink" : "text-mute hover:text-ink"}`}>
                {x === "agent" ? t(`role.${role}` as Key) : t("ws.skillResult")}
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1">
          {rightView === "agent" && job
            ? <AgentPanel job={job} role={role} onOpenResult={(id) => open(id, true)} />
            : <Inspector id={openId} onSelect={setOpenId} />}
        </div>
      </aside>
    </div>
  );
}
