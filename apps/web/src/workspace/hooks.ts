import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, type Job } from "../api";

export const POLL_MS = 1000; // live job/events refresh; polling pauses in hidden tabs (TanStack default) and stops when the job settles

/**
 * A generation job. Exactly one component per job is the `owner` (the conversation turn): it polls while the job is
 * draft/generating and refreshes the lists once when it settles. Every other caller only reads the shared cache.
 */
export function useJob(id: string | null, owner = false) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["job", id],
    queryFn: () => api<Job>(`/studio/jobs/${id}`),
    enabled: !!id,
    refetchInterval: owner ? (query) => (["draft", "generating"].includes(query.state.data?.status ?? "draft") ? POLL_MS : false) : false,
  });
  const settled = q.data?.status === "completed" || q.data?.status === "failed";
  useEffect(() => {
    if (!owner || !settled) return;
    for (const key of ["skills", "jobs", "evaluations", "agents"]) qc.invalidateQueries({ queryKey: [key] });
  }, [owner, settled, qc]);
  return q;
}

/**
 * One package file as text. Shared by the Files tab and the Skill Flow so a file is fetched once per version and path
 * (TanStack dedupes concurrent requests for the same key and serves later readers from the cache).
 */
export const fileQuery = (versionId: string, path: string) => ({
  queryKey: ["file", versionId, path] as const,
  queryFn: () => api<string>(`/studio/versions/${versionId}/files/${path}`),
  staleTime: Infinity, // a stored version is immutable (edits create a new version): never refetch the same file
});
