import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cerveja Barato | Mapa de preços de cerveja - São Paulo",
  description: "Encontre bares e cervejas com os melhores preços no estado de São Paulo.",
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
