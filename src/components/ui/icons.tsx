import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const Logo = (p: IconProps) => (
  <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" {...p}>
    <path d="M5 26V15h4v11M11 26V8h5v18M18 26V12h4v14M24 26V18h3v8" fill="none" stroke="#31E6B0" strokeWidth="2" strokeLinejoin="round" />
    <path d="M4 26.5h24" stroke="#31BDE6" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="13.5" cy="5" r="1.4" fill="#31BDE6" />
  </svg>
);
export const GitHubMark = (p: IconProps) => (
  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);
export const ZoomIn = (p: IconProps) => (<Icon {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></Icon>);
export const ZoomOut = (p: IconProps) => (<Icon {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" /></Icon>);
export const RotateLeft = (p: IconProps) => (<Icon {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Icon>);
export const RotateRight = (p: IconProps) => (<Icon {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></Icon>);
export const Home = (p: IconProps) => (<Icon {...p}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></Icon>);
export const Tag = (p: IconProps) => (<Icon {...p}><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.2" /></Icon>);
export const Orbit = (p: IconProps) => (<Icon {...p}><ellipse cx="12" cy="12" rx="10" ry="4.5" /><circle cx="12" cy="12" r="2.2" /></Icon>);
export const Close = (p: IconProps) => (<Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>);
export const External = (p: IconProps) => (<Icon {...p}><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></Icon>);
export const Target = (p: IconProps) => (<Icon {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></Icon>);
export const Check = (p: IconProps) => (<Icon {...p}><path d="M5 12l5 5L20 7" /></Icon>);
export const Warning = (p: IconProps) => (<Icon {...p}><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18v.01" /></Icon>);
export const Chevron = (p: IconProps) => (<Icon {...p}><path d="M6 9l6 6 6-6" /></Icon>);
export const Spark = (p: IconProps) => (<Icon {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" /></Icon>);
export const Plane = (p: IconProps) => (<Icon {...p}><path d="M21 12.5 3 5l3.5 7L3 19l18-6.5Z" /><path d="M6.5 12H13" /></Icon>);
export const Keyboard = (p: IconProps) => (<Icon {...p}><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></Icon>);
