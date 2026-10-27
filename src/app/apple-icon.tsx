import { ImageResponse } from "next/og";

// home-screen icon for iPhone/iPad (they ignore SVG icons); same artwork as icon.svg, iOS rounds the corners
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#171717" }}>
        <svg width="112" height="112" viewBox="0 0 24 24" fill="none" stroke="#fafafa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 14v2.2l1.6 1" />
          <path d="M16 2v3" />
          <path d="M21 7.338V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h2.338" />
          <path d="M3 9h5.859" />
          <path d="M8 2v3" />
          <circle cx="16" cy="16" r="6" />
        </svg>
      </div>
    ),
    size,
  );
}
