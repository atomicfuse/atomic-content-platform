import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Nunito } from "next/font/google";
import { Sidebar } from "@/components/layout/Sidebar";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atomic Network",
  description: "Central control panel for the Atomic content network",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en" className={nunito.variable} suppressHydrationWarning>
      <body className="bg-[var(--bg-primary)] text-[var(--text-primary)] antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
        >
          <ToastProvider>
            <div className="flex h-screen overflow-hidden">
              <Sidebar />
              <main className="flex-1 overflow-y-auto p-6">{children}</main>
            </div>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
