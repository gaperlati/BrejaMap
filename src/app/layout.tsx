import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BrejaMap | Mapa de preços de cerveja",
  description: "Encontre bares e cervejas com os melhores preços.",
};

/** Lets `env(safe-area-inset-*)` resolve on notched iPhones / home indicator. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={plusJakarta.variable}>
      <body className="antialiased min-h-screen bg-stone-950 text-stone-100 font-sans">
        {children}
      </body>
    </html>
  );
}
