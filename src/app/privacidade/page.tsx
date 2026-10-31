import type { Metadata } from "next";
import Link from "next/link";

const title = "Política de privacidade | BrejaMap";
const description = "Quais dados o BrejaMap coleta, para quê, por quanto tempo e como pedir a exclusão.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/privacidade" },
  // Nested metadata objects replace (not merge with) the layout's, so repeat the shared fields.
  openGraph: { type: "website", locale: "pt_BR", siteName: "BrejaMap", title, description, url: "/privacidade" },
  twitter: { card: "summary_large_image", title, description },
};

/** Last time the text below changed (shown to visitors). */
const UPDATED_AT = "31 de outubro de 2026";

/** Owner's contact for privacy requests (server-only env; read at build time). */
const contactEmail = process.env.CONTACT_EMAIL?.trim() || null;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-stone-100">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))] text-sm leading-relaxed text-stone-300">
      <Link href="/" className="text-amber-400 hover:text-amber-300">
        ← Voltar ao mapa
      </Link>

      <h1 className="mt-6 text-2xl font-bold text-stone-50">Política de privacidade</h1>
      <p className="mt-1 text-xs text-stone-500">Atualizada em {UPDATED_AT}.</p>

      <div className="mt-8 space-y-8">
        <p>
          O BrejaMap é um mapa colaborativo de preços de cerveja em bares. Coletamos o mínimo necessário
          para o mapa funcionar e para evitar spam. Não vendemos dados, não exibimos anúncios e não usamos
          cookies de rastreamento. Medimos o uso de forma agregada e sem cookies (veja “Serviços de
          terceiros” abaixo).
        </p>

        <Section title="O que coletamos">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-stone-100">Conta de login</strong> (opcional; necessária para
              cadastrar bar, favoritar, avaliar e ler cardápio por foto):
              ao entrar com o Google ou com código por e-mail, nosso provedor de autenticação (Supabase Auth)
              guarda seu e-mail, um identificador da conta e, no caso do Google, os dados básicos de perfil
              que o Google envia (como nome e foto). O BrejaMap usa apenas o identificador e o e-mail; nome e
              foto não são exibidos.
            </li>
            <li>
              <strong className="text-stone-100">Autoria das contribuições</strong>: bares cadastrados e
              edições de preços guardam o identificador da conta de quem fez a alteração (quando há login)
              e a data. Bares e preços são públicos; seu e-mail e o identificador da conta nunca são
              mostrados no app.
            </li>
            <li>
              <strong className="text-stone-100">Favoritos e avaliações</strong>: os bares que você favorita
              e as notas (1 a 5) que você dá ficam ligados à sua conta. Os favoritos só você vê; das notas,
              o app mostra apenas a média e a quantidade de cada bar, nunca quem avaliou.
            </li>
            <li>
              <strong className="text-stone-100">Confirmações de preço</strong>: ao tocar em “Ainda é esse
              preço? Sim”, só a data de atualização daquele preço muda. Não guardamos quem confirmou.
            </li>
            <li>
              <strong className="text-stone-100">Foto do cardápio</strong> (só se você usar “Ler cardápio
              por foto”): a imagem é reduzida no seu aparelho (o que também remove dados como a localização
              da foto), enviada ao nosso servidor e repassada uma única vez, pelo Vercel AI Gateway, a um
              modelo de IA que lê os preços. O BrejaMap não guarda a foto; apenas os preços que você revisar
              e salvar ficam no mapa. Não envie fotos com pessoas ou dados pessoais.
            </li>
            <li>
              <strong className="text-stone-100">Proteção contra abuso</strong>: para limitar cadastros,
              edições, confirmações, denúncias, avaliações, favoritos e leituras de cardápio em excesso,
              guardamos contadores temporários identificados por um hash SHA-256 com chave secreta (salt) do
              seu endereço IP e, quando há login, do identificador da sua conta. O IP em si nunca é gravado nesses contadores nem nos dados de bares e preços.
            </li>
            <li>
              <strong className="text-stone-100">Localização</strong>: se você permitir, o navegador informa
              sua posição para centralizar o mapa e ordenar bares por distância. Isso acontece só no seu
              aparelho: a posição não é enviada ao nosso servidor nem guardada. Para buscar bares,
              enviamos apenas os limites da área visível do mapa.
            </li>
            <li>
              <strong className="text-stone-100">Armazenamento no navegador</strong>: a sessão de login
              fica salva no armazenamento local do navegador para você continuar conectado. Não usamos
              cookies de publicidade.
            </li>
          </ul>
        </Section>

        <Section title="Serviços de terceiros">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-stone-100">Google</strong>: o mapa usa o Google Maps e o login pode
              usar sua conta Google. O Google trata esses dados conforme a{" "}
              <a
                href="https://policies.google.com/privacy?hl=pt-BR"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 underline underline-offset-2 hover:text-amber-300"
              >
                política de privacidade dele
              </a>
              .
            </li>
            <li>
              <strong className="text-stone-100">Vercel AI Gateway e provedor do modelo de IA</strong>
              (atualmente o Google Gemini): recebem a foto do cardápio só quando você usa “Ler cardápio por
              foto”, para extrair os preços, e a tratam conforme as políticas deles.
            </li>
            <li>
              <strong className="text-stone-100">Vercel Web Analytics e Speed Insights</strong>: contam
              visitas às páginas e medem o desempenho de carregamento de forma agregada, sem cookies e sem
              identificar você; também registramos de forma anônima quando o mapa falha ao carregar.
            </li>
            <li>
              <strong className="text-stone-100">OpenStreetMap (Nominatim)</strong>: o texto digitado em
              “Buscar endereço” é enviado diretamente do seu navegador ao serviço de busca do OpenStreetMap.
            </li>
            <li>
              <strong className="text-stone-100">Supabase</strong> (banco de dados e login) e{" "}
              <strong className="text-stone-100">Vercel</strong> (hospedagem): processam os dados acima
              para o app funcionar. Como qualquer serviço web, eles podem registrar dados técnicos das
              requisições (como IP e navegador) em logs de segurança e operação próprios.
            </li>
          </ul>
        </Section>

        <Section title="Para que usamos">
          <p>
            Apenas para permitir o login, guardar seus favoritos e avaliações, ler cardápios quando você
            pede, registrar quem cadastrou ou editou cada bar (moderação e combate a spam), limitar abusos e
            entender, de forma agregada, se o app está funcionando bem. Não usamos seus dados para marketing nem os compartilhamos além dos
            serviços listados acima.
          </p>
        </Section>

        <Section title="Por quanto tempo guardamos">
          <ul className="list-disc space-y-2 pl-5">
            <li>Conta de login: enquanto ela existir, até você pedir a exclusão.</li>
            <li>
              Contadores anti-abuso: duram de 10 minutos a 1 dia e são apagados automaticamente a partir de um
              dia depois de expirar.
            </li>
            <li>Favoritos e avaliações: até você removê-los ou excluir a conta (são apagados junto com ela).</li>
            <li>
              Foto do cardápio: não é guardada pelo BrejaMap; existe só durante a leitura.
            </li>
            <li>
              Bares e preços: continuam públicos no mapa. Se sua conta for excluída, eles permanecem, mas
              deixam de estar ligados a você.
            </li>
          </ul>
        </Section>

        <Section title="Seus direitos e contato">
          <p>
            Conforme a LGPD, você pode pedir acesso, correção ou exclusão dos seus dados.{" "}
            {contactEmail ? (
              <>
                Escreva para{" "}
                <a
                  href={`mailto:${contactEmail}`}
                  className="text-amber-400 underline underline-offset-2 hover:text-amber-300"
                >
                  {contactEmail}
                </a>
                .
              </>
            ) : (
              <>Escreva para o e-mail de suporte exibido na janela de login do Google do BrejaMap.</>
            )}
          </p>
        </Section>
      </div>
    </main>
  );
}
