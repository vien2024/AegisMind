import type { SVGProps } from "react";

/**
 * Small inline stroke-icon set (lucide-compatible geometry, no dependency).
 */
const PATHS = {
  dashboard: ["M3 3h7v9H3z", "M14 3h7v5h-7z", "M14 12h7v9h-7z", "M3 16h7v5H3z"],
  chat: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  target: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
    "M12 11.5a.5.5 0 1 0 0 1",
  ],
  bug: [
    "M8 6a4 4 0 0 1 8 0",
    "M6 9h12v4a6 6 0 0 1-12 0z",
    "M3 13h3",
    "M18 13h3",
    "M4 7l2 1.5",
    "M20 7l-2 1.5",
    "M4 18l2-1.5",
    "M20 18l-2-1.5",
    "M12 15v6",
  ],
  activity: ["M3 12h4l3 8 4-16 3 8h4"],
  terminal: ["M4 5h16v14H4z", "M8 10l3 2-3 2", "M13 14h4"],
  audioLines: ["M4 10v4", "M8 7v10", "M12 4v16", "M16 7v10", "M20 10v4"],
  box: ["M3 8l9-5 9 5v8l-9 5-9-5z", "M3 8l9 5 9-5", "M12 13v8"],
  refresh: [
    "M1 4v6h6",
    "M23 20v-6h-6",
    "M20.5 9A9 9 0 0 0 5.6 5.6L1 10",
    "M3.5 15a9 9 0 0 0 14.9 3.4L23 14",
  ],
  grid: ["M3 3h8v8H3z", "M13 3h8v8h-8z", "M3 13h8v8H3z", "M13 13h8v8h-8z"],
  cpu: [
    "M6 6h12v12H6z",
    "M9 9h6v6H9z",
    "M9 2v4",
    "M15 2v4",
    "M9 18v4",
    "M15 18v4",
    "M2 9h4",
    "M2 15h4",
    "M18 9h4",
    "M18 15h4",
  ],
  bot: ["M6 8h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z", "M12 4v4", "M9 14h0", "M15 14h0", "M2 12h2", "M20 12h2"],
  server: ["M3 4h18v6H3z", "M3 14h18v6H3z", "M7 7h0", "M7 17h0"],
  sparkles: ["M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z", "M18 15l.9 1.8 1.8.9-1.8.9-.9 1.8-.9-1.8-1.8-.9 1.8-.9z"],
  wrench: [
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.7-3.7a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 1 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z",
  ],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  shieldOff: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "M3 3l18 18"],
  checkCircle: ["M22 11.1V12a10 10 0 1 1-5.9-9.1", "M22 4l-10 10-3-3"],
  fileText: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M8 13h8", "M8 17h5"],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    "M12 2v3",
    "M12 19v3",
    "M2 12h3",
    "M19 12h3",
    "M5 5l2 2",
    "M17 17l2 2",
    "M19 5l-2 2",
    "M7 17l-2 2",
  ],
  panelLeft: ["M3 4h18v16H3z", "M9 4v16"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"],
  sun: [
    "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    "M12 1v2",
    "M12 21v2",
    "M4.2 4.2l1.4 1.4",
    "M18.4 18.4l1.4 1.4",
    "M1 12h2",
    "M21 12h2",
    "M4.2 19.8l1.4-1.4",
    "M18.4 5.6l1.4-1.4",
  ],
  chevronDown: ["M6 9l6 6 6-6"],
  chevronRight: ["M9 6l6 6-6 6"],
  plus: ["M12 5v14", "M5 12h14"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  filter: ["M3 5h18l-7 8v6l-4 2v-8z"],
  download: ["M12 3v12", "M7 12l5 5 5-5", "M4 21h16"],
  external: ["M14 3h7v7", "M21 3l-9 9", "M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"],
  play: ["M6 4l14 8-14 8z"],
  pause: ["M8 5h3v14H8z", "M13 5h3v14h-3z"],
  stop: ["M6 6h12v12H6z"],
  reset: ["M1 4v6h6", "M3.5 10a9 9 0 1 0 2.9-6.7"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
  alert: ["M12 3l10 18H2z", "M12 9v5", "M12 18h0"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M12 7v5l3 2"],
  sliders: ["M4 6h16", "M4 12h16", "M4 18h16", "M9 4v4", "M15 10v4", "M7 16v4"],
  more: ["M12 6h0", "M12 12h0", "M12 18h0"],
  globe: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", "M3 12h18", "M12 3a15 15 0 0 1 0 18", "M12 3a15 15 0 0 0 0 18"],
  database: [
    "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z",
    "M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6",
    "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  ],
  key: ["M15 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M11.5 11.5L3 20", "M6 17l2 2", "M9 14l2 2"],
  layers: ["M12 2l9 5-9 5-9-5z", "M3 12l9 5 9-5", "M3 17l9 5 9-5"],
  gitBranch: ["M6 3v12", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 9a6 6 0 0 1-6 6H6"],
  eye: ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  book: ["M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z", "M20 4h-3a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h4z"],
  workflow: ["M3 4h6v6H3z", "M15 14h6v6h-6z", "M9 7h3a3 3 0 0 1 3 3v7"],
  inbox: ["M3 12h5l2 3h4l2-3h5", "M5 5h14l2 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"],
  lock: ["M5 11h14v9H5z", "M8 11V8a4 4 0 0 1 8 0v3"],
  chart: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  className = "h-4 w-4",
  ...rest
}: { name: IconName; className?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
