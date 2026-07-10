import { HTTP_REFERER, X_TITLE } from "../lib/openrouter_constants";
import {
  intersectImageSupportedParameters,
  intersectStringLists,
  type ImageCapabilityDescriptor,
} from "./image_capability_intersection";

export type { ImageCapabilityDescriptor } from "./image_capability_intersection";

export interface ImageCatalogModel {
  id: string;
  name?: string;
  description?: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: Record<string, ImageCapabilityDescriptor>;
  supports_streaming?: boolean;
}

interface ImagePricingLine {
  billable?: string;
  unit?: string;
  cost_usd?: number | string;
  variant?: string;
}

interface ImageEndpoint {
  provider_name?: string;
  provider_slug: string;
  provider_tag?: string | null;
  supported_parameters?: Record<string, ImageCapabilityDescriptor>;
  allowed_passthrough_parameters?: string[];
  supports_streaming?: boolean;
  pricing?: ImagePricingLine[];
}

export interface PreparedImagePricingLine {
  billable: string;
  unit: string;
  costUsd: number;
  variant?: string;
}

export interface PreparedImageEndpoint {
  providerName?: string;
  providerSlug: string;
  providerTag?: string | null;
  supportedParameters: Record<string, ImageCapabilityDescriptor>;
  allowedPassthroughParameters: string[];
  supportsStreaming: boolean;
  pricing: PreparedImagePricingLine[];
}

export interface ImageEndpointResponse {
  endpoints?: ImageEndpoint[];
  data?: { endpoints?: ImageEndpoint[] };
}

export type ImageEndpointFetchResult =
  | { status: "available"; response: ImageEndpointResponse }
  | { status: "unavailable"; reason: "not_found" | "no_endpoints" }
  | { status: "transient_failure"; reason: string };

export interface PreparedImageModel {
  modelId: string;
  imageOnly: boolean;
  name: string;
  description?: string;
  provider: string;
  canonicalSlug: string;
  supportedParameters: string[];
  architecture: { modality: string };
  imageCapabilities: {
    isAvailable: true;
    pricePerImage?: number;
    pricePerMegapixel?: number;
    pricingSkus?: { imageToken?: string; imageOutput?: string };
    supportedParameters: Record<string, ImageCapabilityDescriptor>;
    supportsStreaming: boolean;
    maxInputReferences?: number;
    allowedPassthroughParameters: string[];
    pricing: PreparedImagePricingLine[];
    endpoints: PreparedImageEndpoint[];
  };
}

function providerFromModelId(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.slice(0, slash) : "unknown";
}

function outputModality(model: ImageCatalogModel): string[] {
  return model.architecture?.output_modalities ?? ["image"];
}

function numericCost(
  value: number | string | undefined,
  includeZero = false,
): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  const isUsable = includeZero ? parsed >= 0 : parsed > 0;
  return Number.isFinite(parsed) && isUsable ? parsed : undefined;
}

function preparePricing(
  pricing: ImagePricingLine[] | undefined,
  includeZero = false,
): PreparedImagePricingLine[] {
  return (pricing ?? []).flatMap((line) => {
    const costUsd = numericCost(line.cost_usd, includeZero);
    if (!line.billable || !line.unit || costUsd === undefined) return [];
    return [{
      billable: line.billable,
      unit: line.unit,
      costUsd,
      variant: line.variant,
    }];
  });
}

function highestCostLine(
  lines: PreparedImagePricingLine[],
  unit: string,
): PreparedImagePricingLine | undefined {
  return lines
    .filter((line) => line.unit === unit)
    .reduce<PreparedImagePricingLine | undefined>(
      (highest, line) =>
        highest === undefined || line.costUsd > highest.costUsd ? line : highest,
      undefined,
    );
}

export async function fetchImageEndpoints(
  modelId: string,
): Promise<ImageEndpointFetchResult> {
  try {
    const response = await fetch(
      `https://openrouter.ai/api/v1/images/models/${modelId}/endpoints`,
      { headers: { "HTTP-Referer": HTTP_REFERER, "X-Title": X_TITLE } },
    );
    if (response.status === 404) {
      return { status: "unavailable", reason: "not_found" };
    }
    if (!response.ok) {
      return {
        status: "transient_failure",
        reason: `HTTP ${response.status}`,
      };
    }

    const payload = await response.json() as ImageEndpointResponse;
    const endpoints = payload.endpoints ?? payload.data?.endpoints;
    if (!Array.isArray(endpoints)) {
      return {
        status: "transient_failure",
        reason: "malformed endpoint payload",
      };
    }
    if (endpoints.length === 0) {
      return { status: "unavailable", reason: "no_endpoints" };
    }
    return { status: "available", response: payload };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[image_sync] endpoint capability fetch failed", {
      modelId,
      error: reason,
    });
    return { status: "transient_failure", reason };
  }
}

export function prepareImageModel(
  model: ImageCatalogModel,
  endpointResponse: ImageEndpointResponse | null,
): PreparedImageModel {
  const endpoints = endpointResponse?.endpoints ?? endpointResponse?.data?.endpoints ?? [];
  const advertisedParameters = model.supported_parameters ?? {};
  const supportedParameters = intersectImageSupportedParameters(
    advertisedParameters,
    endpoints.map((endpoint) => endpoint.supported_parameters ?? {}),
  );
  const preparedEndpoints = endpoints.map((endpoint) => ({
    ...(endpoint.provider_name === undefined
      ? {}
      : { providerName: endpoint.provider_name }),
    providerSlug: endpoint.provider_slug,
    ...(endpoint.provider_tag === undefined
      ? {}
      : { providerTag: endpoint.provider_tag }),
    supportedParameters: endpoint.supported_parameters ?? {},
    allowedPassthroughParameters:
      endpoint.allowed_passthrough_parameters ?? [],
    supportsStreaming: endpoint.supports_streaming === true,
    pricing: preparePricing(endpoint.pricing, true),
  }));
  // Keep the existing positive-only aggregate pricing contract unchanged.
  // Endpoint records retain valid zero-cost lines for future routing choices.
  const pricing = endpoints.flatMap((endpoint) => preparePricing(endpoint.pricing));
  const outputImagePricing = pricing.filter(
    (line) => line.billable === "output_image",
  );
  // The summary contract exposes one number, while OpenRouter can return
  // resolution/provider variants. Use the highest advertised positive price so
  // the picker never presents a lower price than a selectable configuration.
  // Full variant data remains available in `pricing` and `endpoints`.
  const perImage = highestCostLine(outputImagePricing, "image");
  const perToken = highestCostLine(outputImagePricing, "token");
  const perMegapixel = highestCostLine(outputImagePricing, "megapixel");
  const inputReferences = supportedParameters.input_references;
  const inputs = model.architecture?.input_modalities ?? ["text"];
  const outputs = outputModality(model);
  const allowedPassthroughParameters = intersectStringLists(
    endpoints.map((endpoint) => endpoint.allowed_passthrough_parameters ?? []),
  ).sort();

  return {
    modelId: model.id,
    imageOnly: !outputs.includes("text"),
    name: model.name ?? model.id,
    description: model.description,
    provider: providerFromModelId(model.id),
    canonicalSlug: model.id,
    supportedParameters: Object.keys(supportedParameters).sort(),
    architecture: { modality: `${inputs.join("+")}->${outputs.join("+")}` },
    imageCapabilities: {
      isAvailable: true,
      pricePerImage: perImage?.costUsd,
      pricePerMegapixel: perMegapixel?.costUsd,
      pricingSkus: perToken
        ? {
            imageToken: String(perToken.costUsd),
            imageOutput: String(perToken.costUsd),
          }
        : undefined,
      supportedParameters,
      supportsStreaming: model.supports_streaming === true &&
        endpoints.length > 0 &&
        endpoints.every((endpoint) => endpoint.supports_streaming === true),
      maxInputReferences:
        inputReferences?.type === "range" &&
          typeof inputReferences.max === "number"
          ? Math.floor(inputReferences.max)
          : undefined,
      allowedPassthroughParameters,
      pricing,
      endpoints: preparedEndpoints,
    },
  };
}
