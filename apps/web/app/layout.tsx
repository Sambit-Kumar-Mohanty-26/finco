import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-instrument",
});

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "FinCo — it tells you what it could not prove",
  description:
    "Reconciles Razorpay settlements to your bank and your ERP, posts a balanced journal, and refuses every match it cannot close to zero paise.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Font variables go on <html>, not <body>. The @theme tokens (--font-display
  // etc.) are declared on :root and reference these; a custom property is
  // substituted at the element where it is declared, so if --font-instrument
  // were only defined on <body>, --font-display would compute to an invalid
  // value on <html> and every descendant would inherit that invalid value.
  return (
    <html
      lang="en-IN"
      className={`${instrument.variable} ${geist.variable} ${plexMono.variable}`}
    >
      <body>
        <noscript>
          {/* motion is progressive: without JS nothing is ever left hidden */}
          <style>{`.rv{opacity:1 !important}`}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
