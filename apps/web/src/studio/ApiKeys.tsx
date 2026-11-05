import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type ApiKeyRow } from "../api";
import { Card, CopyBlock, ErrorBox } from "./ui";

export function ApiKeys() {
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
    <Card title="API keys (for /v1 and the SDK)">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <input aria-label="key name" className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm" placeholder="my-backend"
          value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={!name || create.isPending} className="rounded bg-slate-800 px-3 py-1 text-sm text-white disabled:opacity-50">Create</button>
      </form>
      {create.error && <ErrorBox error={create.error} />}
      {created && (
        <div className="mt-3">
          <p className="text-xs text-amber-800">Shown once. Store it in your server environment — never in browser code.</p>
          <CopyBlock label="API key" text={created} />
          <CopyBlock label="Python" text={`from agent_builder import SkillClient\nclient = SkillClient(api_key=os.environ["AAB_API_KEY"])\nprint(client.list())`} />
        </div>
      )}
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {keys.data?.map((k) => (
          <li key={k.id} className="flex items-center justify-between py-1.5">
            <span><span className="font-mono text-xs">{k.prefix}…</span> {k.name}</span>
            {k.revoked_at ? <span className="text-xs text-slate-400">revoked</span> : (
              <button type="button" onClick={() => revoke.mutate(k.id)} className="text-xs text-rose-700 hover:underline">Revoke</button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
