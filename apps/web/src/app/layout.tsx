import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Nunito } from "next/font/google";
import "./globals.css";
import { WireframeBanner } from "../components/WireframeBanner";
import { Nav } from "../components/Nav";

const serif = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap"
});

const sans = Nunito({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap"
});

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
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <WireframeBanner />
        <Nav />
        <div className="pa-main">{children}</div>
      </body>
    </html>
  );
}
