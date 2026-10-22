import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "GitCity — Every codebase has a skyline",
  description: "Turn any public GitHub repository into a living 3D cyberpunk city. Directories become districts, files become buildings.",
  openGraph: {
    title: "GitCity — Every codebase has a skyline",
    description: "Turn any public GitHub repository into a living 3D cyberpunk city.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#080D12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
