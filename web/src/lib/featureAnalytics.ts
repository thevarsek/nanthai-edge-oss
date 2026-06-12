import { captureAnalytics } from "@/lib/analytics";

type FeatureUsageProperties = Record<string, unknown>;

export function captureFeatureUsage(properties: FeatureUsageProperties) {
  captureAnalytics("feature_used", properties);
}

export function captureSendFeatureUsage(properties: Record<string, unknown>) {
  const base = {
    feature_area: "chat",
    chat_id: properties.chat_id,
    client_event_id: properties.client_event_id,
  };
  captureAnalytics("feature_used", {
    ...base,
    feature: "chat",
    action: "message_send_attempted",
  });
  if (Number(properties.participant_count ?? 0) > 1) {
    captureAnalytics("feature_used", {
      ...base,
      feature_area: "multi_model",
      feature: "multi_model_chat",
      participant_count: properties.participant_count,
    });
  }
  if (properties.search_mode && properties.search_mode !== "none") {
    captureAnalytics("feature_used", {
      ...base,
      feature_area: "search_research",
      feature: "search",
      search_mode: properties.search_mode,
      complexity: properties.complexity,
    });
  }
  if (Number(properties.integration_count ?? 0) > 0) {
    captureAnalytics("feature_used", {
      ...base,
      feature_area: "docs_drive",
      feature: "integrations",
      integration_count: properties.integration_count,
    });
  }
  if (properties.has_audio === true) {
    captureAnalytics("feature_used", {
      ...base,
      feature_area: "audio",
      feature: "audio_input",
    });
  }
  if (properties.has_video_config === true || properties.has_image_attachment === true) {
    captureAnalytics("feature_used", {
      ...base,
      feature_area: "image_video",
      feature: properties.has_video_config === true ? "video_generation" : "image_attachment",
      attachment_count: properties.attachment_count,
    });
  }
  if (properties.subagents_enabled === true) {
    captureAnalytics("feature_used", {
      ...base,
      feature_area: "subagents",
      feature: "subagents",
    });
  }
}

export function captureResponseCopied(properties: {
  message_id: string;
  model_id?: string | null;
  has_media?: boolean;
  source?: string;
}) {
  captureAnalytics("response_copied", {
    feature_area: "chat",
    ...properties,
  });
  captureFeatureUsage({
    feature_area: "chat",
    feature: "assistant_response",
    action: "copied",
    message_id: properties.message_id,
  });
}

export function captureArtifactUsage(
  action: "opened" | "downloaded",
  properties: {
    message_id: string;
    artifact_id: string;
    mime_type?: string | null;
    size_bytes?: number | null;
    has_document_id?: boolean;
  },
) {
  const event = action === "opened" ? "artifact_opened" : "artifact_downloaded";
  captureAnalytics(event, {
    feature_area: "docs_drive",
    ...properties,
  });
  captureFeatureUsage({
    feature_area: "docs_drive",
    feature: "generated_artifact",
    action,
    message_id: properties.message_id,
    artifact_id: properties.artifact_id,
    mime_type: properties.mime_type,
  });
}

export function captureSettingChanged(properties: {
  setting_key: string;
  setting_area: "chat" | "model_picker" | "search_research" | "subagents" | "audio" | "image_video" | "settings";
  value_type: "boolean" | "number" | "string" | "null";
}) {
  captureAnalytics("setting_changed", {
    feature_area: properties.setting_area,
    ...properties,
  });
  captureFeatureUsage({
    feature_area: properties.setting_area,
    feature: "settings",
    action: "changed",
    setting_key: properties.setting_key,
  });
}
