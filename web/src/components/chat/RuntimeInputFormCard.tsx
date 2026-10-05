import { useState } from "react";
import { useMutation } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convexErrorMessage } from "@/lib/convexErrors";

type InputForm = {
  source: string;
  url?: string;
  fields: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    secret: boolean;
    options: string[];
  }>;
};

export function RuntimeInputFormCard({ requestId, form, canRespond }: {
  requestId: Id<"runtimePermissionRequests">;
  form: InputForm;
  canRespond: boolean;
}) {
  const { t } = useTranslation();
  const respond = useMutation(api.runtime_host.input_requests.respond);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const url = (() => {
    try {
      const candidate = new URL(form.url ?? "");
      return candidate.protocol === "https:" && !candidate.username && !candidate.password
        ? candidate
        : null;
    } catch {
      return null;
    }
  })();

  async function answer(outcome: "submitted" | "cancelled") {
    setBusy(true);
    setError(undefined);
    try {
      const content = Object.fromEntries(form.fields.flatMap(field => {
        const value = values[field.id] ?? (field.type === "boolean" ? false : undefined);
        if (!field.required && value === "" && (field.type === "number" || field.type === "integer")) {
          return [];
        }
        return value === undefined ? [] : [[
          field.id,
          field.type === "number" || field.type === "integer" ? Number(value) : value,
        ]];
      }));
      await respond({
        requestId,
        outcome,
        ...(outcome === "submitted" ? { content: JSON.stringify(content) } : {}),
      });
    } catch (cause) {
      setError(convexErrorMessage(cause, t("runtime_permission_response_failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={event => {
        event.preventDefault();
        void answer("submitted");
      }}
      data-ph-block
      data-ph-mask
    >
      {url && (
        <a
          href={url.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline"
        >
          {t("remote_mcp_open_host", { host: url.host })}
        </a>
      )}
      {form.fields.map(field => (
        <label key={field.id} className="block space-y-1 text-sm">
          <span>{field.label}</span>
          {field.type === "boolean" ? (
            <input
              type="checkbox"
              checked={values[field.id] === true}
              disabled={!canRespond || busy}
              onChange={event => setValues(current => ({
                ...current,
                [field.id]: event.target.checked,
              }))}
            />
          ) : (
            <>
              <input
                className="w-full rounded-lg border border-border bg-surface px-3 py-2"
                type={field.secret
                  ? "password"
                  : field.type === "number" || field.type === "integer" ? "number" : "text"}
                step={field.type === "integer" ? 1 : "any"}
                required={field.required}
                value={String(values[field.id] ?? "")}
                list={field.secret || !field.options.length ? undefined : `${requestId}-${field.id}`}
                disabled={!canRespond || busy}
                autoComplete={field.secret ? "off" : undefined}
                onChange={event => setValues(current => ({
                  ...current,
                  [field.id]: event.target.value,
                }))}
              />
              {field.options.length > 0 && (
                <datalist id={`${requestId}-${field.id}`}>
                  {field.options.map(option => <option key={option} value={option} />)}
                </datalist>
              )}
            </>
          )}
        </label>
      ))}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canRespond || busy}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {t(busy ? "runtime_permission_sending" : "accept")}
        </button>
        <button
          type="button"
          disabled={!canRespond || busy}
          onClick={() => void answer("cancelled")}
          className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
        >
          {t("cancel")}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
