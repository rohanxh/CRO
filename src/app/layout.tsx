import type { Metadata } from "next";
import { IBM_Plex_Sans, Unbounded } from "next/font/google";
import "./globals.css";

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin"],
});

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Free website conversion audit",
  description:
    "Paste your page. It is loaded on a phone and a desktop in a real browser, checked against your reviews and local listings, and you get a prioritised list of what to fix.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${unbounded.variable} ${plex.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col text-ink-100">
        <div className="sky" aria-hidden="true">
          <div className="stars stars-far" />
          <div className="stars stars-mid" />
          <div className="stars stars-near" />
        </div>
        {children}
      </body>
    </html>
  );
}
