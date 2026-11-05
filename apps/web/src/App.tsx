import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api";
import { ApiKeys } from "./studio/ApiKeys";
import { SkillStudio } from "./studio/SkillStudio";

export function App() {
  const [page, setPage] = useState<"studio" | "keys">("studio");
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<{ status: string }>("/health") });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <h1 className="text-lg font-bold">AI Agent Builder</h1>
          <nav className="flex gap-1 text-sm">
            {(["studio", "keys"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPage(p)}
                className={`rounded px-3 py-1 ${page === p ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600"}`}>
                {p === "studio" ? "Skill Studio" : "API keys"}
              </button>
            ))}
          </nav>
          <p className="ml-auto text-xs text-slate-500" role="status">
            API: {health.isPending ? "checking…" : health.isError ? "offline" : health.data.status}
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{page === "studio" ? <SkillStudio /> : <ApiKeys />}</main>
    </div>
  );
}
