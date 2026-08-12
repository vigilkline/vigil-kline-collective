import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://vigilkline.local"),
  title: "VIGILKLINE — Resale, under control",
  description: "A focused operating system for independent resale inventory, listings, orders, money, and planning.",
  applicationName: "VIGILKLINE",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", apple: "/favicon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "VIGILKLINE" },
  openGraph: { title: "VIGILKLINE", description: "Resale, under control.", images: [{ url: "/og.png", width: 1731, height: 909, alt: "VIGILKLINE — Resale, under control." }] },
  twitter: { card: "summary_large_image", title: "VIGILKLINE", description: "Resale, under control.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><meta name="theme-color" content="#151713"/><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
