import type { Metadata } from "next";
import { IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import { AppSidebar, AppTopbar } from "@/components/AppSidebar";
import { ResearchBanner } from "@/components/ResearchBanner";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
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
    <html
      suppressHydrationWarning
      lang="zh-CN"
      className={`${plex.variable} ${serif.variable} h-full`}
    >
      <body className="min-h-full bg-surface text-on-surface antialiased font-sans">
        <ThemeProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <ResearchBanner />
              <AppTopbar />
              <main className="flex-1 w-full px-3 py-6 sm:px-5 lg:px-6 xl:px-8">
                {children}
              </main>
            </SidebarInset>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
