const PATHS = {
  select: "M5 3l14 8-6.5 1.5L9.5 19z",
  draw: "M4 18l4-12 8 3 4 9zM4 18h0M8 6h0M16 9h0M20 18h0",
  magnet: "M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4zM6 8h4M14 8h4",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  upload: "M12 15V4M7 9l5-5 5 5M4 15v5h16v-5",
  radar: "M12 12l7-7M5.6 18.4a9 9 0 1 1 12.8 0M8.5 15.5a5 5 0 1 1 7 0M12 12h.01",
  zones: "M4 4h7v7H4zM13 13h7v7h-7zM13 4l7 7M4 13l7 7",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  close: "M6 6l12 12M18 6L6 18",
  info: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
