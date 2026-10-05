import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useSharedData } from "./useSharedData";
import type { ConnectionFilterValue } from "@/components/shared/ConnectionFilter";

export function useConnectionFilter() {
  const [connectionFilter, setConnectionFilter] = useState<ConnectionFilterValue>("all");
  const { personas } = useSharedData();
  const filtered = useQuery(api.personas.queries.list, connectionFilter === "all" ? "skip" : { runtimePlacement: connectionFilter });
  return { connectionFilter, setConnectionFilter, connectionPersonas: connectionFilter === "all" ? personas : filtered };
}

