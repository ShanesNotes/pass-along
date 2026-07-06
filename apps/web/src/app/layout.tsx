import type { Metadata } from "next";
import type { ReactNode } from "react";
import { WireframeBanner } from "../components/WireframeBanner";
import { Nav } from "../components/Nav";

export const metadata: Metadata = {
  title: "Pass Along — direction wireframes",
  description: "Pre-meeting greybox wireframes over synthetic fixture data"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "#222",
          background: "#fafafa"
        }}
      >
        <WireframeBanner />
        <Nav />
        <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 16px 64px" }}>{children}</div>
      </body>
    </html>
  );
}
