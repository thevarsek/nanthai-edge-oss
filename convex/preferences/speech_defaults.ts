import { ConvexError } from "convex/values";

export const SPEECH_OUTPUT_FORMAT_VALUES = ["mp3", "pcm"] as const;

export interface SpeechGenerationConfig {
  voice?: string;
  speed?: number;
  outputFormat?: "mp3" | "pcm";
  instructions?: string;
  style?: string;
  styleDegree?: number;
}

export interface SpeechPreferenceValues {
  preferredVoice?: string | null;
  defaultSpeechSpeed?: number | null;
  defaultSpeechOutputFormat?: string | null;
  defaultSpeechInstructions?: string | null;
  defaultSpeechStyle?: string | null;
  defaultSpeechStyleDegree?: number | null;
}

function validationError(field: string, message: string): never {
  throw new ConvexError({
    code: "VALIDATION_ERROR" as const,
    message: `${field}: ${message}`,
  });
}

function normalizedText(
  value: string | null | undefined,
  field: string,
  maxLength: number,
): string | null | undefined {
  if (value == null) return value;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    return validationError(field, `must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function boundedNumber(
  value: number | null | undefined,
  field: string,
  min: number,
  max: number,
): number | null | undefined {
  if (value == null) return value;
  if (!Number.isFinite(value) || value < min || value > max) {
    return validationError(field, `must be between ${min} and ${max}.`);
  }
  return value;
}

/** Validates the provider-independent superset stored in Chat Defaults. */
export function validateSpeechPreferenceWrite(
  values: SpeechPreferenceValues,
): SpeechPreferenceValues {
  const normalized: SpeechPreferenceValues = {};
  if (values.preferredVoice !== undefined) {
    normalized.preferredVoice = normalizedText(
      values.preferredVoice,
      "preferredVoice",
      160,
    );
  }
  if (values.defaultSpeechSpeed !== undefined) {
    normalized.defaultSpeechSpeed = boundedNumber(
      values.defaultSpeechSpeed,
      "defaultSpeechSpeed",
      0.25,
      4,
    );
  }
  if (values.defaultSpeechOutputFormat !== undefined) {
    const format = normalizedText(
      values.defaultSpeechOutputFormat,
      "defaultSpeechOutputFormat",
      8,
    )?.toLowerCase();
    if (format != null && !SPEECH_OUTPUT_FORMAT_VALUES.includes(
      format as (typeof SPEECH_OUTPUT_FORMAT_VALUES)[number],
    )) {
      return validationError(
        "defaultSpeechOutputFormat",
        `must be one of: ${SPEECH_OUTPUT_FORMAT_VALUES.join(", ")}.`,
      );
    }
    normalized.defaultSpeechOutputFormat = format;
  }
  if (values.defaultSpeechInstructions !== undefined) {
    normalized.defaultSpeechInstructions = normalizedText(
      values.defaultSpeechInstructions,
      "defaultSpeechInstructions",
      1_000,
    );
  }
  if (values.defaultSpeechStyle !== undefined) {
    normalized.defaultSpeechStyle = normalizedText(
      values.defaultSpeechStyle,
      "defaultSpeechStyle",
      80,
    );
  }
  if (values.defaultSpeechStyleDegree !== undefined) {
    normalized.defaultSpeechStyleDegree = boundedNumber(
      values.defaultSpeechStyleDegree,
      "defaultSpeechStyleDegree",
      0.01,
      2,
    );
  }
  return normalized;
}

export function speechConfigFromPreferences(
  values: SpeechPreferenceValues | null | undefined,
): SpeechGenerationConfig {
  const format = values?.defaultSpeechOutputFormat;
  return {
    voice: values?.preferredVoice?.trim() || undefined,
    speed: values?.defaultSpeechSpeed ?? undefined,
    outputFormat: format === "pcm" ? "pcm" : "mp3",
    instructions: values?.defaultSpeechInstructions?.trim() || undefined,
    style: values?.defaultSpeechStyle?.trim() || undefined,
    styleDegree: values?.defaultSpeechStyleDegree ?? undefined,
  };
}
