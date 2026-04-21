import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Receptionist AI — Never Miss a Call Again",
  description:
    "AI-powered receptionist that answers calls 24/7, captures customer details, and sends booking requests to your inbox instantly.",
  keywords: [
    "AI receptionist",
    "virtual receptionist",
    "phone answering service",
    "booking automation",
    "missed calls",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
