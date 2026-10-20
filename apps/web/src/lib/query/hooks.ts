"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const useProfile = () => useQuery({ queryKey: ["profile"], queryFn: () => api.getProfile() });
export const useJobs = () => useQuery({ queryKey: ["jobs"], queryFn: () => api.listJobs() });
export const useJob = (stateKey: string) =>
  useQuery({ queryKey: ["job", stateKey], queryFn: () => api.getJob(stateKey) });
export const useInsights = () => useQuery({ queryKey: ["insights"], queryFn: () => api.getInsights() });
