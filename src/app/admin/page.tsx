import type { Metadata } from "next";
import Link from "next/link";
import { ModerationView } from "@/components/ModerationView";

export const metadata: Metadata = {
  title: "Moderação | BrejaMap",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
      <Link href="/" className="text-sm text-amber-400 hover:text-amber-300">
        ← Voltar ao mapa
      </Link>
      <h1 className="mt-6 text-2xl font-bold text-stone-50">Moderação</h1>
      <ModerationView />
    </main>
  );
}
