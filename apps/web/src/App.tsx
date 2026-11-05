import { useQuery } from "@tanstack/react-query";

export function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const r = await fetch("/api/health");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { status: string };
    },
  });

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">AI Agent Builder</h1>
      <p className="mt-2" role="status">
        API: {health.isPending ? "checking…" : health.isError ? "offline" : health.data.status}
      </p>
    </main>
  );
}
