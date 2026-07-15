import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { PWARegister } from "@/components/pwa-register";
import { getDesignMode } from "@/lib/design-mode";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Tess Console", template: "%s · Tess Console" },
  description: "Operations console for Calculatry, GlobalResumeHub, and CheckInvestNg",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  applicationName: "Tess Console",
  appleWebApp: { capable: true, title: "Tess", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/favicon.png", sizes: "32x32", type: "image/png" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const design = await getDesignMode();
  return (
    <html lang="en" data-design={design} className={`${inter.variable} ${mono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {/* Capture-mode redaction: when Tess's recorder is filming (it sets
            window.__tessCapture / localStorage before page scripts run), tag
            <html> so the .redact CSS blurs sensitive data. Parser-blocking on
            purpose — the class lands before any content paints. No-op for
            normal users. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=document.documentElement;if(window.__tessCapture||localStorage.getItem("tess-capture")==="1")d.classList.add("tess-capture");if(window.__tessNoRedact||localStorage.getItem("tess-no-redact")==="1")d.classList.add("tess-no-redact")}catch(e){}`,
          }}
        />
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster richColors position="bottom-right" />
          <PWARegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
