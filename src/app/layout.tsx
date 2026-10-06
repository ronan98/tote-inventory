import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Home Inventory", description: "A place for everything. Find your totes, photos, and contents.", appleWebApp: { capable: true, statusBarStyle: "default", title: "Inventory" }, robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#28634c" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
