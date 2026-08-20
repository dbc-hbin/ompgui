import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "./globals.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ompgui",
  description: "Web UI for the oh-my-pi (omp) coding agent",
  // PWA-like behavior on iOS: standalone chrome, no telephone autodetect.
  appleWebApp: {
    capable: true,
    title: "ompgui",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

// theme-color adapts to light/dark so the browser chrome / iOS status bar
// matches the active theme. `viewportFit: cover` lets us honor safe-area-inset
// (used by DirectoryPicker footer) on notched devices.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9F6" },
    { media: "(prefers-color-scheme: dark)", color: "#1B1916" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        {/* Pre-hydration: apply stored theme before first paint to avoid a flash
            of the wrong theme. Matches html.dark selector in globals.css. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var r=document.documentElement,t=localStorage.getItem("ompgui-theme")||localStorage.getItem("omp-theme"),p=localStorage.getItem("ompgui-palette"),d=matchMedia("(prefers-color-scheme: dark)").matches;r.dataset.palette=p==="omp"?"omp":"warm";if(t==="dark"||(t!=="light"&&t!=="dark"&&d))r.classList.add("dark")}catch(e){document.documentElement.dataset.palette="warm"}})();`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem("ompgui-lang")||localStorage.getItem("omp-lang");if(l!=="en"&&l!=="zh-CN"&&l!=="ja"&&l!=="ko"){var n=(navigator.language||"").toLowerCase();l=n.indexOf("zh")===0?"zh-CN":n.indexOf("ja")===0?"ja":n.indexOf("ko")===0?"ko":"en"}document.documentElement.lang=l}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {children}
      </body>
    </html>
  );
}
