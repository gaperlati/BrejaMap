import type { Metadata } from "next";
import Link from "next/link";
import { AccountView } from "@/components/AccountView";

export const metadata: Metadata = {
  title: "Minha conta | BrejaMap",
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <Link href="/" className="text-sm text-amber-400 hover:text-amber-300">
        ← Voltar ao mapa
      </Link>
      <h1 className="mt-6 text-2xl font-bold text-stone-50">Minha conta</h1>
      <AccountView />
    </main>
  );
}
