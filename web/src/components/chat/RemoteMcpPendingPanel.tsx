import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Server } from "lucide-react";
import { RemoteMcpInvocationResult } from "@/components/settings/RemoteMcpInvocationResult";
import { useTranslation } from "react-i18next";

export function RemoteMcpPendingPanel({ chatId }: { chatId: Id<"chats"> }) {
  const { t } = useTranslation();
  const pending = useQuery(api.mcp.queries.listPendingForChat, { chatId });
  const respond = useAction(api.mcp.continuation_actions.respondToInput);
  const updateTask = useAction(api.mcp.task_actions.updateTask);
  const [busyId, setBusyId] = useState<string>();
  if (!pending || pending.length === 0) return null;

  return (
    <aside className="fixed bottom-24 right-5 z-40 max-h-[65vh] w-[min(28rem,calc(100vw-2rem))] overflow-auto rounded-2xl border border-border bg-background p-4 shadow-2xl">
      <div className="mb-3 flex items-center gap-2">
        <Server size={16} className="text-primary" />
        <div>
          <h2 className="text-sm font-semibold">{t("remote_mcp_request")}</h2>
          <p className="text-[11px] text-muted">{t("remote_mcp_pending_description")}</p>
        </div>
      </div>
      <div className="space-y-4">
        {pending.map((invocation) => (
          <section key={invocation.invocationId} className="rounded-xl bg-surface-2 p-3">
            <p className="mb-2 text-xs font-medium">{invocation.itemName}</p>
            <p className="mb-3 text-[11px] text-muted">{invocation.serverName} · {t(`remote_mcp_kind_${invocation.kind}`, { defaultValue: invocation.kind.replace("_", " ") })}</p>
            <RemoteMcpInvocationResult
              value={invocation}
              busy={busyId === invocation.invocationId}
              onResume={async (inputResponses) => {
                setBusyId(invocation.invocationId);
                try { await respond({ invocationId: invocation.invocationId, inputResponses }); }
                finally { setBusyId(undefined); }
              }}
              onTask={async (invocationId, operation, inputResponses) => {
                setBusyId(invocationId);
                try { await updateTask({ invocationId, operation, inputResponses }); }
                finally { setBusyId(undefined); }
              }}
            />
          </section>
        ))}
      </div>
    </aside>
  );
}
