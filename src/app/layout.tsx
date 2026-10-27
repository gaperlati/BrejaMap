import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

/** Absolute base for OG/canonical URLs. Vercel sets VERCEL_PROJECT_PRODUCTION_URL automatically. */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

const title = "BrejaMap | Mapa de preços de cerveja";
const description =
  "Encontre os bares com a cerveja mais barata perto de você: chope, long neck, lata e happy hour no mapa.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: "BrejaMap",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "BrejaMap",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

/** Lets `env(safe-area-inset-*)` resolve on notched iPhones / home indicator. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0c0a09",
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
