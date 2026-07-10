export interface ImageCapabilityDescriptor {
  type?: string;
  values?: string[];
  min?: number;
  max?: number;
}

export type ImageSupportedParameterMap = Record<
  string,
  ImageCapabilityDescriptor
>;

type DescriptorKind = "enum" | "range" | "boolean" | "other";

/**
 * Return only model-level image options accepted by every current endpoint.
 * The model descriptor supplies canonical spelling and ordering; endpoint
 * descriptors are the definitive routing constraints.
 */
export function intersectImageSupportedParameters(
  modelParameters: ImageSupportedParameterMap,
  endpointParameters: ImageSupportedParameterMap[],
): ImageSupportedParameterMap {
  if (endpointParameters.length === 0) {
    return {};
  }

  const result: ImageSupportedParameterMap = {};
  for (const [name, modelDescriptor] of Object.entries(modelParameters)) {
    const descriptors = endpointParameters.map((parameters) => parameters[name]);
    if (descriptors.some((descriptor) => descriptor === undefined)) continue;

    const endpointDescriptors = descriptors as ImageCapabilityDescriptor[];
    const intersected = intersectDescriptor(modelDescriptor, endpointDescriptors);
    if (intersected) result[name] = intersected;
  }
  return result;
}

/** Preserve first-list order while retaining values present in every list. */
export function intersectStringLists(lists: string[][]): string[] {
  if (lists.length === 0) return [];
  const remaining = lists.slice(1).map((list) => new Set(list));
  return Array.from(new Set(lists[0])).filter((value) =>
    value.trim().length > 0 &&
    remaining.every((values) => values.has(value))
  );
}

function intersectDescriptor(
  modelDescriptor: ImageCapabilityDescriptor,
  endpointDescriptors: ImageCapabilityDescriptor[],
): ImageCapabilityDescriptor | undefined {
  const kind = descriptorKind(modelDescriptor);
  if (endpointDescriptors.some((descriptor) => descriptorKind(descriptor) !== kind)) {
    return undefined;
  }

  if (kind === "enum") {
    return intersectEnumDescriptor(modelDescriptor, endpointDescriptors);
  }
  if (kind === "range") {
    return intersectRangeDescriptor(modelDescriptor, endpointDescriptors);
  }
  if (kind === "boolean") {
    return { type: "boolean" };
  }
  return undefined;
}

function intersectEnumDescriptor(
  modelDescriptor: ImageCapabilityDescriptor,
  endpointDescriptors: ImageCapabilityDescriptor[],
): ImageCapabilityDescriptor | undefined {
  const modelValues = enumValues(modelDescriptor);
  if (!modelValues || modelValues.length === 0) return undefined;

  const endpointValues = endpointDescriptors.map(enumValues);
  if (endpointValues.some((values) => values === undefined)) return undefined;
  const endpointSets = endpointValues.map((values) => new Set(values));
  const seen = new Set<string>();
  const values = modelValues.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return endpointSets.every((supported) => supported.has(value));
  });
  if (values.length === 0) return undefined;
  return { type: "enum", values };
}

function intersectRangeDescriptor(
  modelDescriptor: ImageCapabilityDescriptor,
  endpointDescriptors: ImageCapabilityDescriptor[],
): ImageCapabilityDescriptor | undefined {
  const allDescriptors = [modelDescriptor, ...endpointDescriptors];
  if (allDescriptors.some((descriptor) =>
    !Number.isFinite(descriptor.min) || !Number.isFinite(descriptor.max)
  )) {
    return undefined;
  }

  const min = Math.max(...allDescriptors.map((descriptor) => descriptor.min as number));
  const max = Math.min(...allDescriptors.map((descriptor) => descriptor.max as number));
  if (min > max) return undefined;
  return { type: "range", min, max };
}

function descriptorKind(descriptor: ImageCapabilityDescriptor): DescriptorKind {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return "other";
  }
  const hasValues = descriptor.values !== undefined;
  const hasMin = descriptor.min !== undefined;
  const hasMax = descriptor.max !== undefined;
  if (hasValues && !Array.isArray(descriptor.values)) return "other";
  if (descriptor.type !== undefined && typeof descriptor.type !== "string") {
    return "other";
  }
  const type = descriptor.type?.trim().toLowerCase();
  if (type !== undefined) {
    if (type === "enum") return hasMin || hasMax ? "other" : "enum";
    if (type === "range") return hasValues ? "other" : "range";
    if (type === "boolean") {
      return hasValues || hasMin || hasMax ? "other" : "boolean";
    }
    return "other";
  }
  if (hasValues && !hasMin && !hasMax) return "enum";
  if (!hasValues && (hasMin || hasMax)) return "range";
  return "other";
}

function enumValues(
  descriptor: ImageCapabilityDescriptor,
): string[] | undefined {
  if (!Array.isArray(descriptor.values)) return undefined;
  if (descriptor.values.some((value) => typeof value !== "string")) {
    return undefined;
  }
  return descriptor.values.filter((value) => value.trim().length > 0);
}
