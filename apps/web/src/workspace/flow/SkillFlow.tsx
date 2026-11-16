/**
 * Skill Flow tab: the real structure of a Skill as a diagram (main data flow + code, tests and docs beside it) with a
 * details panel. Data: the version detail already loaded by the Inspector, plus the package files read through the
 * same query keys as the Files tab (so each file is fetched once). Everything shown comes from deriveFlow().
 * Layout: two columns (diagram | details) when the panel is wide, stacked otherwise; the diagram itself switches
 * between a two-lane grid and a single column with a left rail. Connectors are SVG paths measured from the cards.
 */
import { useQueries } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { VersionDetail } from "../../api";
import { useT, type Key } from "../../i18n";
import { fileQuery } from "../hooks";
import { Alert, Retry } from "../icons";
import { Button, Empty, ErrorNote } from "../kit";
import { deriveFlow, flowFiles } from "./derive";
import { FlowNodeCard } from "./FlowNodeCard";
import { NodeDetail } from "./NodeDetail";
import type { Flow, FlowEdge, FlowNode } from "./types";

/** Main-lane step that each side node is drawn next to. */
function rowOf(n: FlowNode, flow: Flow): string {
  if (n.kind === "checks") return "validation";
  return flow.kind === "instructions" ? "instructions" : "execution";
}
const SIDE_ORDER: FlowNode["kind"][] = ["function", "dependencies", "runner", "tests", "docs", "checks"];

export function SkillFlow({ v }: { v: VersionDetail }) {
  const t = useT();
  const paths = useMemo(() => flowFiles(v), [v]);
  const queries = useQueries({ queries: paths.map((p) => fileQuery(v.id, p)) });
  const pending = queries.some((q) => q.isPending);
  const failed = paths.filter((_, i) => queries[i].isError);
  const texts = queries.map((q) => q.data);
  const flow = useMemo(() => {
    if (pending) return null;
    const files: Record<string, string | undefined> = {};
    paths.forEach((p, i) => { if (typeof texts[i] === "string") files[p] = texts[i] as string; });
    return deriveFlow({ version: v, files, failed });
    // texts change identity only when a query's data changes
  }, [pending, v, paths, ...texts, failed.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = () => queries.forEach((q) => q.isError && q.refetch());

  if (v.files.length === 0) return <Empty title={t("sf.empty")} />;
  if (pending) return <p role="status" className="p-4 text-sm text-mute" data-testid="sf-loading">{t("sf.loading")}</p>;
  if (failed.length === paths.length && paths.length > 0) {
    return (
      <div className="space-y-2 p-4" data-testid="sf-error">
        <ErrorNote error={t("sf.error")} />
        <ErrorNote error={queries.find((q) => q.error)?.error} />
        <Button size="sm" onClick={retry}><Retry size={13} />{t("sf.retry")}</Button>
      </div>
    );
  }
  return <FlowView v={v} flow={flow!} onRetry={failed.length ? retry : undefined} />;
}

function FlowView({ v, flow, onRetry }: { v: VersionDetail; flow: Flow; onRetry?: () => void }) {
  const t = useT();
  const main = flow.nodes.filter((n) => n.lane === "main");
  const sideFor = (row: string) => flow.nodes.filter((n) => n.lane === "side" && rowOf(n, flow) === row)
    .sort((a, b) => SIDE_ORDER.indexOf(a.kind) - SIDE_ORDER.indexOf(b.kind));
  const [picked, setPicked] = useState<string | null>(null);
  const selected = flow.nodes.find((n) => n.id === picked) ?? flow.nodes.find((n) => n.id === "execution" || n.id === "instructions") ?? main[0];
  const rootRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState({ panel: true, diagram: true });

  useLayoutEffect(() => {
    const measure = () => {
      const w = rootRef.current?.clientWidth ?? 0;
      const d = diagramRef.current?.clientWidth ?? 0;
      if (!w) return; // not laid out (tests, hidden tab): keep the defaults
      setWide((x) => (x.panel === w >= 820 && x.diagram === d >= 460 ? x : { panel: w >= 820, diagram: d >= 460 }));
    };
    measure();
    if (typeof ResizeObserver === "undefined" || !rootRef.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  const select = (id: string) => {
    setPicked(id);
    // stacked layout: bring the details into view (the diagram stays where it was)
    if (!wide.panel) requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  };

  /** ↑/↓ (and Home/End) move focus between the step buttons in reading order; Enter/Space select (native button). */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...(diagramRef.current?.querySelectorAll<HTMLButtonElement>("button[data-node]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.min(items.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className="space-y-3 p-4" data-testid="skill-flow" data-kind={flow.kind}>
      <header className="space-y-1.5">
        <p className="text-[12.5px] leading-relaxed text-ink/90">{t("sf.intro")}</p>
        <p className="flex items-start gap-1.5 rounded-md border border-warn/25 bg-warn/[0.06] px-2.5 py-1.5 text-[12px] leading-snug text-ink/85" data-testid="sf-approx">
          <Alert size={13} className="mt-px shrink-0 text-warn" />{t("sf.approx")}
        </p>
        {flow.warnings.length > 0 && (
          <ul className="space-y-1" data-testid="sf-warnings">
            {flow.warnings.map((w) => (
              <li key={w} data-warning={w} className="rounded-md border border-bad/20 bg-bad/[0.05] px-2.5 py-1.5 text-[12px] text-ink/90">{t(`sf.warn.${w}` as Key)}</li>
            ))}
          </ul>
        )}
        {onRetry && <Button size="sm" onClick={onRetry}><Retry size={13} />{t("sf.retry")}</Button>}
      </header>

      <div className={wide.panel ? "grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-4" : "space-y-4"}>
        <div className="min-w-0 space-y-2">
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-faint" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" /></svg>{t("sf.legend.solid")}</span>
            <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" /></svg>{t("sf.legend.dashed")}</span>
          </p>
          <p className="sr-only">{t("sf.keys")}</p>
          <div ref={diagramRef} onKeyDown={onKey} className="relative" role="group" aria-label={t("sf.diagram")} data-testid="sf-diagram" data-layout={wide.diagram ? "lanes" : "rail"}>
            <Connectors flow={flow} selected={selected?.id} rail={!wide.diagram} />
            <ol className={wide.diagram ? "relative space-y-6" : "relative space-y-3 pl-6"}>
              {main.map((n) => {
                const side = sideFor(n.id);
                return (
                  <li key={n.id} className={wide.diagram ? "grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-start gap-x-8" : "space-y-2"}>
                    {/* single column: keep room on the right for the arcs to the steps listed under this one */}
                    <div className={wide.diagram ? "min-w-0" : "mr-10 min-w-0"}><FlowNodeCard node={n} selected={selected?.id === n.id} onSelect={select} /></div>
                    {side.length > 0 && (
                      <ul className={`min-w-0 space-y-1.5 ${wide.diagram ? "pr-8" : "pl-5 pr-10"}`}>
                        {side.map((s) => <li key={s.id}><FlowNodeCard node={s} selected={selected?.id === s.id} onSelect={select} compact={s.kind === "function"} /></li>)}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
        <div ref={detailRef} className={`min-w-0 ${wide.panel ? "sticky top-0 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-lg border border-line bg-panel p-3" : "rounded-lg border border-line bg-panel p-3"}`}>
          {selected ? <NodeDetail key={selected.id} v={v} flow={flow} node={selected} onSelect={select} /> : <p className="text-sm text-mute">{t("sf.select")}</p>}
        </div>
      </div>
    </div>
  );
}

type Rect = { l: number; r: number; t: number; b: number; cx: number; cy: number };

/**
 * SVG connectors drawn under the cards from their measured boxes. Only edges of the flow are drawn (each has evidence).
 * Measures its own parent element (the diagram): the svg's own ref is attached before this component's layout effect,
 * a ref held by the parent is not.
 */
function Connectors({ flow, selected, rail }: { flow: Flow; selected?: string; rail: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [paths, setPaths] = useState<{ d: string; e: FlowEdge; hot: boolean }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const root = svgRef.current?.parentElement;
    if (!root) return;
    const draw = () => {
      const base = root.getBoundingClientRect();
      if (!base.width) return;
      const box = (id: string): Rect | null => {
        const el = root.querySelector<HTMLElement>(`button[data-node="${CSS.escape(id)}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const l = r.left - base.left, tp = r.top - base.top;
        return { l, r: l + r.width, t: tp, b: tp + r.height, cx: l + r.width / 2, cy: tp + r.height / 2 };
      };
      const mainIds = new Set(flow.nodes.filter((n) => n.lane === "main").map((n) => n.id));
      // same-column arcs get increasing offsets, shortest first, so nested arcs do not cross
      const arcs: { e: FlowEdge; a: Rect; b: Rect }[] = [];
      const out: { d: string; e: FlowEdge; hot: boolean }[] = [];
      for (const e of flow.edges) {
        const a = box(e.from), b = box(e.to);
        if (!a || !b) continue;
        const hot = e.from === selected || e.to === selected;
        const bothMain = mainIds.has(e.from) && mainIds.has(e.to);
        if (bothMain && !rail) {
          out.push({ d: `M${a.cx},${a.b} L${b.cx},${b.t - 2}`, e, hot });
        } else if (bothMain && rail) {
          const x = 10;
          out.push({ d: `M${a.l},${a.cy} H${x} V${b.cy} H${b.l - 2}`, e, hot });
        } else if (a.r < b.l - 4 || b.r < a.l - 4) {
          const [sx, ex] = a.r < b.l ? [a.r, b.l - 2] : [a.l, b.r + 2];
          const mx = (sx + ex) / 2;
          out.push({ d: `M${sx},${a.cy} C${mx},${a.cy} ${mx},${b.cy} ${ex},${b.cy}`, e, hot });
        } else {
          arcs.push({ e, a, b });
        }
      }
      arcs.sort((x, y) => Math.abs(x.a.cy - x.b.cy) - Math.abs(y.a.cy - y.b.cy));
      arcs.forEach(({ e, a, b }, k) => {
        const x = Math.max(a.r, b.r) + 10 + 6 * Math.min(k, 4);
        const hot = e.from === selected || e.to === selected;
        out.push({ d: `M${a.r},${a.cy} C${x},${a.cy} ${x},${b.cy} ${b.r + 2},${b.cy}`, e, hot });
      });
      setPaths(out);
      setSize({ w: root.scrollWidth, h: root.scrollHeight });
    };
    draw();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(draw);
    ro.observe(root);
    return () => ro.disconnect();
  }, [flow, selected, rail]);

  return (
    <svg ref={svgRef} className="pointer-events-none absolute left-0 top-0 overflow-visible" width={size.w} height={size.h} aria-hidden="true" data-testid="sf-edges">
      <defs>
        <marker id="sf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--color-line-strong)" />
        </marker>
        <marker id="sf-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--color-accent)" />
        </marker>
      </defs>
      {[...paths].sort((x, y) => Number(x.hot) - Number(y.hot)).map(({ d, e, hot }) => (
        <path key={`${e.from}>${e.to}:${e.reason}`} d={d} fill="none" data-edge={`${e.from}>${e.to}`} data-reason={e.reason}
          stroke={hot ? "var(--color-accent)" : "var(--color-line-strong)"} strokeWidth={hot ? 1.75 : 1.25}
          strokeDasharray={e.source === "scanned" ? "4 3" : undefined} markerEnd={`url(#${hot ? "sf-arrow-hot" : "sf-arrow"})`} />
      ))}
    </svg>
  );
}
