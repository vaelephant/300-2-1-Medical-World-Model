import type { Metadata } from "next";
import { IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import { AppNav } from "@/components/AppNav";
import { ResearchBanner } from "@/components/ResearchBanner";
import "./globals.css";




const plex = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const serif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "HCC World Model Studio",
  description: "DR.SEEK research prototype — synthetic HCC trajectories",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className={`${plex.variable} ${serif.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-surface text-on-surface antialiased font-sans">
        <ResearchBanner />
        <AppNav />
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          {children}
        </main>
      </body>
    </html>
  );
}
