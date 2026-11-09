/** Inline stroke icons (no icon dependency). 16px grid, 1.5 stroke, currentColor. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function I({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const Plus = (p: P) => <I {...p}><path d="M8 3v10M3 8h10" /></I>;
export const Spark = (p: P) => <I {...p}><path d="M8 1.5l1.4 4.1L13.5 7l-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4z" /></I>;
export const Cube = (p: P) => <I {...p}><path d="M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8z" /><path d="M2.5 4.8L8 7.9l5.5-3.1M8 7.9v6.3" /></I>;
export const Key = (p: P) => <I {...p}><circle cx="5.5" cy="10.5" r="3" /><path d="M7.6 8.4L13.5 2.5M11 5l1.5 1.5M12.5 3.5L14 5" /></I>;
export const Chip = (p: P) => <I {...p}><rect x="4" y="4" width="8" height="8" rx="1.5" /><path d="M6 1.5v2.5M10 1.5v2.5M6 12v2.5M10 12v2.5M1.5 6h2.5M1.5 10h2.5M12 6h2.5M12 10h2.5" /></I>;
export const Globe = (p: P) => <I {...p}><circle cx="8" cy="8" r="6.2" /><path d="M1.8 8h12.4M8 1.8c1.8 1.9 2.6 4 2.6 6.2S9.8 12.3 8 14.2C6.2 12.3 5.4 10.2 5.4 8S6.2 3.7 8 1.8z" /></I>;
export const FileI = (p: P) => <I {...p}><path d="M9 1.8H4.5A1.2 1.2 0 003.3 3v10a1.2 1.2 0 001.2 1.2h7A1.2 1.2 0 0012.7 13V5.5z" /><path d="M9 1.8v3.7h3.7" /></I>;
export const Folder = (p: P) => <I {...p}><path d="M1.8 4.3a1 1 0 011-1h3.1l1.4 1.5h5.9a1 1 0 011 1v6.9a1 1 0 01-1 1H2.8a1 1 0 01-1-1z" /></I>;
export const Check = (p: P) => <I {...p}><path d="M3.2 8.4l3 3 6.6-6.8" /></I>;
export const Cross = (p: P) => <I {...p}><path d="M4 4l8 8M12 4l-8 8" /></I>;
export const Clock = (p: P) => <I {...p}><circle cx="8" cy="8" r="6.2" /><path d="M8 4.6V8l2.3 1.4" /></I>;
export const Alert = (p: P) => <I {...p}><path d="M8 1.8l6.5 11.4H1.5z" /><path d="M8 6.3v3.2M8 11.6v.1" /></I>;
export const Wrench = (p: P) => <I {...p}><path d="M10.6 2.1a3.3 3.3 0 00-4 4.4L2.2 10.9a1.3 1.3 0 001.9 1.9l4.4-4.4a3.3 3.3 0 004.4-4l-2 2-1.6-.4-.4-1.6z" /></I>;
export const Flask = (p: P) => <I {...p}><path d="M6 1.8h4M6.7 1.8v4.3L2.9 12.4a1.2 1.2 0 001 1.8h8.2a1.2 1.2 0 001-1.8L9.3 6.1V1.8" /><path d="M4.6 9.6h6.8" /></I>;
export const Shield = (p: P) => <I {...p}><path d="M8 1.8l5 1.9v3.9c0 3.1-2.1 5.6-5 6.6-2.9-1-5-3.5-5-6.6V3.7z" /><path d="M5.8 8l1.6 1.6L10.4 6.5" /></I>;
export const Download = (p: P) => <I {...p}><path d="M8 2v8M4.8 7l3.2 3.2L11.2 7M2.5 13.5h11" /></I>;
export const Chevron = (p: P) => <I {...p}><path d="M6 3.5L10.5 8 6 12.5" /></I>;
export const Panel = (p: P) => <I {...p}><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.5" /><path d="M10 2.5v11" /></I>;
export const Menu = (p: P) => <I {...p}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></I>;
export const Send = (p: P) => <I {...p}><path d="M14 2L7.2 8.8M14 2L9.6 14l-2.4-5.2L2 6.4z" /></I>;
export const Retry = (p: P) => <I {...p}><path d="M2.6 8a5.4 5.4 0 019.5-3.5L13.5 6M13.5 2.5V6H10M13.4 8a5.4 5.4 0 01-9.5 3.5L2.5 10M2.5 13.5V10H6" /></I>;
export const Pencil = (p: P) => <I {...p}><path d="M10.8 2.6l2.6 2.6-8 8H2.8v-2.6z" /></I>;
export const Activity = (p: P) => <I {...p}><path d="M1.5 8h3l2-5 3 10 2-5h3" /></I>;
export const CodeI = (p: P) => <I {...p}><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5M9 3l-2 10" /></I>;
export const Grid = (p: P) => <I {...p}><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></I>;
export const Plug = (p: P) => <I {...p}><path d="M6 1.5v3M10 1.5v3M4 4.5h8v2.5a4 4 0 01-8 0zM8 11v3.5" /></I>;
export const Gear = (p: P) => <I {...p}><circle cx="8" cy="8" r="2" /><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" /></I>;
export const Trash = (p: P) => <I {...p}><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5" /></I>;
