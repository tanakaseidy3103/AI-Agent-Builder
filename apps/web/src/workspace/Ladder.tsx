/** Compact generated → validated → tested → verified marks for lists. */
import { useT, type Key } from "../i18n";
import { LEVELS, type Level } from "./evidence";
import { Check } from "./icons";

export function Ladder({ levels }: { levels: Record<Level, boolean> }) {
  const t = useT();
  return (
    <ol className="flex flex-wrap gap-1" aria-label={t("ev.title")}>
      {LEVELS.map((l) => (
        <li key={l} data-level={l} data-reached={levels[l]}
          className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] ring-1 ring-inset ${levels[l] ? (l === "verified" ? "bg-ok/10 text-ok ring-ok/30" : "text-ink/85 ring-line-strong") : "text-faint ring-line"}`}>
          {levels[l] && <Check size={10} />}{t(`ev.${l}` as Key)}
        </li>
      ))}
    </ol>
  );
}
