import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ApiKeyRow } from "../api";
import { useT } from "../i18n";
import { Card, CopyBlock, ErrorBox, inputCls, primaryBtn } from "./ui";

export function ApiKeys() {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
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
    <Card title={t("keys.title")} className="max-w-3xl">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <input aria-label={t("keys.name")} className={inputCls} placeholder="my-backend" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={!name || create.isPending} className={primaryBtn}>{t("keys.create")}</button>
      </form>
      {create.error && <div className="mt-3"><ErrorBox error={create.error} /></div>}
      {created && (
        <div className="mt-3">
          <p className="text-xs text-amber-200">{t("keys.once")}</p>
          <CopyBlock label="API key" text={created} />
          <CopyBlock label="Python" text={`from agent_builder import SkillClient\nclient = SkillClient(api_key=os.environ["AAB_API_KEY"])\nprint(client.list())`} />
        </div>
      )}
      {keys.error && <div className="mt-3"><ErrorBox error={keys.error} /></div>}
      {keys.data?.length === 0 && <p className="mt-3 text-sm text-slate-400">{t("keys.empty")}</p>}
      <ul className="mt-3 divide-y divide-white/5 text-sm">
        {keys.data?.map((k) => (
          <li key={k.id} className="flex items-center justify-between py-2">
            <span className="text-slate-200"><span className="font-mono text-xs text-slate-400">{k.prefix}…</span> {k.name}</span>
            {k.revoked_at ? <span className="text-xs text-slate-500">{t("keys.revoked")}</span> : (
              <button type="button" onClick={() => revoke.mutate(k.id)} className="text-xs text-rose-300 hover:underline">{t("keys.revoke")}</button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
