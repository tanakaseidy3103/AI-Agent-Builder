import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, type Job } from "../api";

/** Polls a generation job while it is draft/generating; refreshes the Skill list when it settles. */
export function useJob(id: string | null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["job", id],
    queryFn: () => api<Job>(`/studio/jobs/${id}`),
    enabled: !!id,
    refetchInterval: (query) => (["draft", "generating"].includes(query.state.data?.status ?? "draft") ? 1000 : false),
  });
  useEffect(() => {
    if (q.data?.status === "completed" || q.data?.status === "failed") {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    }
  }, [q.data?.status, qc]);
  return q;
}
