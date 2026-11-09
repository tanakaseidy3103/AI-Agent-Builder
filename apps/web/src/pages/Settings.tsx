import { useLang, useT } from "../i18n";
import { ApiKeys } from "../workspace/ApiKeys";
import { PageHeader, card, sectionTitle } from "../workspace/kit";

export function Settings() {
  const t = useT();
  const { lang, setLang } = useLang();
  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title={t("nav.settings")} body={t("set.body")} />
      <div className="space-y-5 px-4 py-5 sm:px-6">
        <section aria-label={t("set.language")} className={`${card} max-w-2xl space-y-2 p-4`}>
          <h2 className={sectionTitle}>{t("set.language")}</h2>
          <div className="flex gap-2" role="radiogroup" aria-label={t("set.language")}>
            {([["en", "English"], ["ja", "日本語"]] as const).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={lang === id} lang={id} onClick={() => setLang(id)}
                className={`h-8 rounded-md border px-3 text-sm ${lang === id ? "border-accent/60 bg-accent/10 text-ink" : "border-line text-mute hover:bg-hover hover:text-ink"}`}>{label}</button>
            ))}
          </div>
        </section>
        <ApiKeys />
      </div>
    </div>
  );
}
