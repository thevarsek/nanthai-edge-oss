import { useState } from "react";
import { useTranslation } from "react-i18next";

type ContentItem = {
  kind: "text" | "image" | "audio" | "blob" | "resource_link";
  role?: string;
  text?: string;
  mimeType?: string;
  name?: string;
  uri?: string;
  sizeBytes?: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function contentItem(value: unknown, role?: string): ContentItem | undefined {
  if (typeof value === "string") return { kind: "text", role, text: value };
  const row = asRecord(value);
  if (!row) return undefined;
  const nested = asRecord(row.resource);
  if (nested) return contentItem(nested, role);
  const text = string(row.text);
  if (text) return { kind: "text", role, text };
  const kind = string(row.kind) ?? string(row.type);
  if (kind === "image" || kind === "audio" || kind === "blob") {
    return {
      kind,
      role,
      mimeType: string(row.mimeType),
      name: string(row.name),
      uri: string(row.uri),
      sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : undefined,
    };
  }
  const uri = string(row.uri) ?? string(row.href);
  return uri ? {
    kind: "resource_link",
    role,
    uri,
    name: string(row.name) ?? string(row.title),
    mimeType: string(row.mimeType),
  } : undefined;
}

function resultContent(root: Record<string, unknown> | undefined): ContentItem[] {
  const persisted = root?.contentItems;
  if (Array.isArray(persisted)) return persisted.flatMap((value) => {
    const item = contentItem(value, string(asRecord(value)?.role));
    return item ? [item] : [];
  });

  const result = asRecord(root?.result);
  const items: ContentItem[] = [];
  if (Array.isArray(result?.messages)) {
    for (const value of result.messages) {
      const message = asRecord(value);
      const values = Array.isArray(message?.content) ? message.content : [message?.content];
      for (const part of values) {
        const item = contentItem(part, string(message?.role));
        if (item) items.push(item);
      }
    }
  }
  for (const key of ["content", "contents"]) {
    const value = result?.[key];
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    for (const part of values) {
      const item = contentItem(part);
      if (item) items.push(item);
    }
  }
  return items;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function TextPreview({ text, role }: { text: string; role?: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > 1_200;
  const visible = truncated && !expanded ? `${text.slice(0, 1_200).trimEnd()}…` : text;
  return (
    <div className="space-y-2 rounded-lg bg-surface p-3">
      {role && <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{t("remote_mcp_role_arg", { role })}</p>}
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed sm:max-h-80">{visible}</pre>
      {truncated && (
        <button type="button" onClick={() => setExpanded((current) => !current)} className="text-xs font-medium text-primary hover:underline">
          {expanded ? t("remote_mcp_collapse_text") : t("remote_mcp_show_full_text")}
        </button>
      )}
    </div>
  );
}

export function RemoteMcpResultPreview({ value }: { value: unknown }) {
  const { t } = useTranslation();
  const [showRaw, setShowRaw] = useState(false);
  const root = asRecord(value);
  const items = resultContent(root);
  const textItems = items.filter((item) => item.kind === "text" && item.text);
  const textCharacters = textItems.reduce((total, item) => total + (item.text?.length ?? 0), 0);
  const approximateTokens = Math.ceil(textCharacters / 4);
  const rawResponse = root?.result ?? value;
  const state = string(root?.state);

  return (
    <section aria-label={t("remote_mcp_result")} className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">{t("remote_mcp_returned_content")}</p>
        {state && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] capitalize text-muted">{t(`remote_mcp_status_${state}`, { defaultValue: state.replace("_", " ") })}</span>}
      </div>
      {items.length > 0 ? (
        <>
          <p className="text-[11px] text-muted">
            {t("remote_mcp_content_block_count", { count: items.length })}
            {textCharacters > 0 ? ` · ${t("remote_mcp_character_token_count", { characters: textCharacters.toLocaleString(), tokens: approximateTokens.toLocaleString() })}` : ""}
          </p>
          <div className="space-y-2">
            {items.map((item, index) => item.kind === "text" && item.text ? (
              <TextPreview key={`${item.kind}-${index}`} text={item.text} role={item.role} />
            ) : (
              <div key={`${item.kind}-${index}`} className="rounded-lg bg-surface p-3 text-xs">
                <p className="font-medium capitalize">{item.name ?? item.kind.replace("_", " ")}</p>
                <p className="mt-1 text-muted">
                  {[item.mimeType, item.sizeBytes !== undefined ? formatBytes(item.sizeBytes) : undefined]
                    .filter(Boolean).join(" · ") || t("remote_mcp_remote_content")}
                </p>
                {safeHttpsUrl(item.uri) ? (
                  <a href={safeHttpsUrl(item.uri)} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-primary hover:underline">{item.uri}</a>
                ) : item.uri ? <p className="mt-1 break-all font-mono text-muted">{item.uri}</p> : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-muted">{t("remote_mcp_no_previewable_content")}</p>
      )}
      <button type="button" onClick={() => setShowRaw((current) => !current)} className="text-xs font-medium text-muted hover:text-foreground">
        {showRaw ? t("remote_mcp_hide_raw_response") : t("remote_mcp_view_raw_response")}
      </button>
      {showRaw && (
        <pre className="max-h-52 overflow-auto rounded-lg bg-surface p-3 text-xs whitespace-pre-wrap break-words sm:max-h-64">
          {JSON.stringify(rawResponse, null, 2)}
        </pre>
      )}
    </section>
  );
}
