import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { DataProblems } from "@/components/layout/data-problems";
import { HeaderRatesSkeleton, HeaderRatesWidget } from "@/components/layout/header-rates";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getHeaderRatesData, getShellData } from "@/server/queries";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: { default: "Budget & Tax", template: "%s · Budget & Tax" },
  description: "Local personal budget and ФОП group 3 tax manager",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
};

/** NBU rates for the top bar — streamed, so a slow or hanging bank.gov.ua never blocks the shell. */
async function LiveHeaderRates() {
  return <HeaderRatesWidget rates={await getHeaderRatesData()} />;
}

/**
 * App shell: sidebar + sticky top bar (NBU rates, theme) + page container.
 * Pages render INSIDE <main>, which already provides the width/padding and a `gap-6` column —
 * a page returns `<><PageHeader … /> …sections</>` (see FOUNDATION_API.md "UI kit").
 * If a data file is corrupt, the page is replaced by <DataProblems> (nothing is overwritten).
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [shell, cookieStore] = await Promise.all([getShellData(), cookies()]);
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ThemeProvider>
          <TooltipProvider delayDuration={300}>
            <SidebarProvider defaultOpen={sidebarOpen}>
              <AppSidebar badges={{ "/debts": { count: shell.overdueDebts, label: "overdue" } }} />
              <SidebarInset className="min-w-0">
                <AppHeader
                  rates={
                    <Suspense fallback={<HeaderRatesSkeleton />}>
                      <LiveHeaderRates />
                    </Suspense>
                  }
                />
                <main
                  id="main"
                  className="mx-auto flex w-full max-w-5xl min-w-0 flex-1 flex-col gap-8 px-4 pt-6 pb-16 md:px-8 md:pt-8"
                >
                  {shell.dataProblems.length > 0 ? (
                    <DataProblems problems={shell.dataProblems} dataDir={shell.dataDir} />
                  ) : (
                    children
                  )}
                </main>
              </SidebarInset>
            </SidebarProvider>
            <Toaster richColors closeButton position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
