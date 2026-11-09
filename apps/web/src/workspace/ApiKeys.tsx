import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ApiKeyRow, type Models } from "../api";
import { useT } from "../i18n";
import { Chip, Key } from "./icons";
import { Button, CopyField, Empty, ErrorNote, Pill, field, sectionTitle } from "./kit";

export function ApiKeys() {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const models = useQuery({ queryKey: ["models"], queryFn: () => api<Models>("/studio/models"), staleTime: Infinity });
  const keys = useQuery({ queryKey: ["keys"], queryFn: () => api<ApiKeyRow[]>("/studio/api-keys") });
  const create = useMutation({
    mutationFn: () => api<{ key: string }>("/studio/api-keys", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: (r) => { setCreated(r.key); setName(""); qc.invalidateQueries({ queryKey: ["keys"] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api<void>(`/studio/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keys"] }),
  });
  return (
    <div className="w-full max-w-2xl space-y-5">
      <section aria-label={t("settings.model")} className="space-y-2 rounded-lg border border-line bg-panel p-4">
        <h2 className={`${sectionTitle} flex items-center gap-1.5`}><Chip size={13} />{t("settings.model")}</h2>
        <p className="text-xs leading-relaxed text-mute">{t("settings.modelBody")}</p>
        {models.error && <ErrorNote error={models.error} />}
        {models.data?.error && <ErrorNote error={models.data.error} />}
        <ul className="flex flex-wrap gap-1.5">
          {models.data?.installed.map((m) => <li key={m}><Pill tone={m === models.data!.default ? "accent" : "mute"}>{m}{m === models.data!.default ? ` · ${t("chat.modelDefault")}` : ""}</Pill></li>)}
        </ul>
      </section>
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink"><Key size={15} className="text-mute" />{t("keys.title")}</h2>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <input aria-label={t("keys.name")} className={field} placeholder="my-backend" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="primary" disabled={!name || create.isPending}>{t("keys.create")}</Button>
      </form>
      {create.error && <ErrorNote error={create.error} />}
      {created && (
        <div className="space-y-2 rounded-lg border border-warn/25 bg-warn/[0.06] p-3">
          <p className="text-xs text-warn">{t("keys.once")}</p>
          <CopyField label="API key" text={created} />
          <CopyField label="Python" text={`from agent_builder import SkillClient\nclient = SkillClient(api_key=os.environ["AAB_API_KEY"])\nprint(client.list())`} />
        </div>
      )}
      {keys.error && <ErrorNote error={keys.error} />}
      {keys.data?.length === 0 && <Empty icon={<Key size={16} />} title={t("keys.empty")} />}
      {!!keys.data?.length && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-panel text-sm">
          {keys.data.map((k) => (
            <li key={k.id} className="flex items-center justify-between px-3 py-2">
              <span className="text-ink"><span className="font-mono text-xs text-mute">{k.prefix}…</span> {k.name}</span>
              {k.revoked_at ? <span className="text-xs text-faint">{t("keys.revoked")}</span> : (
                <Button size="sm" variant="quiet" className="text-bad" onClick={() => revoke.mutate(k.id)}>{t("keys.revoke")}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
