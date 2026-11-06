import { useId } from "react";

/** A shaded SVG robot whose pose and lights reflect a REAL backend state (never animated without an event). */
export type RobotState = "waiting" | "idle" | "planning" | "working" | "testing" | "failed" | "completed" | "planned";

const EYE: Record<RobotState, string> = {
  waiting: "#4b5680", planned: "#3a4266", idle: "#7fb2ff", planning: "#b3a8ff",
  working: "#8fd0ff", testing: "#ffd08a", failed: "#ff7a7a", completed: "#7ff0b5",
};

export function Robot({ accent, state, label }: { accent: string; state: RobotState; label: string }) {
  const active = state === "working" || state === "planning" || state === "testing";
  const dim = state === "waiting" || state === "planned";
  const id = `r${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={label} className={`h-24 w-24 ${active ? "robot-working" : ""}`}
      style={{ opacity: dim ? 0.45 : 1, filter: state === "planned" ? "grayscale(1)" : undefined }}>
      <defs>
        <linearGradient id={`${id}-shell`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e9edff" />
          <stop offset="0.55" stopColor="#b9c2e6" />
          <stop offset="1" stopColor="#6c77a6" />
        </linearGradient>
        <linearGradient id={`${id}-visor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a2246" />
          <stop offset="1" stopColor="#070b1c" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor={EYE[state]} stopOpacity="0.9" />
          <stop offset="1" stopColor={EYE[state]} stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* floor shadow */}
      <ellipse cx="60" cy="112" rx="30" ry="5" fill="#000" opacity="0.35" />
      {/* antenna */}
      <line x1="60" y1="14" x2="60" y2="24" stroke="#9aa5d4" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="11" r="5" fill={state === "failed" ? "#ff6b6b" : accent} />
      {/* head */}
      <rect x="28" y="22" width="64" height="46" rx="18" fill={`url(#${id}-shell)`} />
      <rect x="35" y="31" width="50" height="27" rx="12" fill={`url(#${id}-visor)`} />
      <circle cx="49" cy="44" r="9" fill={`url(#${id}-glow)`} />
      <circle cx="71" cy="44" r="9" fill={`url(#${id}-glow)`} />
      {state === "failed" ? (
        <g stroke={EYE.failed} strokeWidth="2.5" strokeLinecap="round">
          <path d="M45 40 l8 8 M53 40 l-8 8" /><path d="M67 40 l8 8 M75 40 l-8 8" />
        </g>
      ) : state === "completed" ? (
        <g stroke={EYE.completed} strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d="M44 45 q5 -6 10 0" /><path d="M66 45 q5 -6 10 0" />
        </g>
      ) : (
        <g fill={EYE[state]}>
          <rect x="45" y="41" width="8" height="6" rx="3" />
          <rect x="67" y="41" width="8" height="6" rx="3" />
        </g>
      )}
      {state === "testing" && (
        <g clipPath={`url(#${id}-clip)`}>
          <clipPath id={`${id}-clip`}><rect x="35" y="31" width="50" height="27" rx="12" /></clipPath>
          <rect className="robot-scan" x="56" y="31" width="8" height="27" fill="#ffd08a" opacity="0.25" />
        </g>
      )}
      {/* body */}
      <rect x="38" y="70" width="44" height="34" rx="12" fill={`url(#${id}-shell)`} />
      <rect x="47" y="78" width="26" height="14" rx="5" fill="#0d1430" />
      <rect x="51" y="82" width="18" height="2.5" rx="1.2" fill={accent} opacity={active ? 1 : 0.5} />
      <rect x="51" y="87" width="11" height="2.5" rx="1.2" fill={accent} opacity={active ? 0.7 : 0.3} />
      {/* arms */}
      <rect x="26" y="74" width="10" height="24" rx="5" fill="#9aa5d4" />
      <rect x="84" y="74" width="10" height="24" rx="5" fill="#9aa5d4" />
      {state === "failed" && (
        <g>
          <circle cx="94" cy="24" r="10" fill="#ff6b6b" />
          <rect x="92.6" y="17" width="2.8" height="9" rx="1.4" fill="#2a0b0b" />
          <circle cx="94" cy="29.5" r="1.6" fill="#2a0b0b" />
        </g>
      )}
    </svg>
  );
}
