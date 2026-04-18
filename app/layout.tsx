import type { Metadata } from "next";
import { Geist_Mono, Manrope } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

const fontSans = Manrope({
  variable: "--font-sans-ui",
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "SubFrame — yapay zekâ video altyazı",
  description:
    "Durumsuz video altyazı aracı: Türkçe konuşmayı metne dökme, çeviri ve tarayıcıdan indirilebilir yumuşak altyazılı MP4.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${fontSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
