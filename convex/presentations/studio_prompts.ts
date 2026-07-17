import type { OpenRouterMessage } from "../lib/openrouter";
import type { PresentationPromptAsset } from "./asset_inputs";
import { buildGenerationMessages } from "./prompts";
import type {
  PresentationCreativeDirection,
  PresentationDirection,
  PresentationImageMode,
  PresentationPlanSlide,
} from "./types";

export function buildStudioGenerationMessages(args: {
  title: string;
  prompt: string;
  direction: PresentationDirection;
  imageMode: PresentationImageMode;
  plan: PresentationPlanSlide[];
  targetSlideIds: string[];
  creativeDirection?: PresentationCreativeDirection;
  assets?: PresentationPromptAsset[];
}): OpenRouterMessage[] {
  const targetIds = new Set(args.targetSlideIds);
  const targetPlan = args.plan.filter((slide) => targetIds.has(slide.id));
  return [
    ...buildGenerationMessages({ ...args, plan: targetPlan }),
    {
      role: "user",
      content: `You are one parallel studio in a coordinated deck. Return exactly the assigned slides above and no others.
Shared visual DNA: ${JSON.stringify(args.creativeDirection ?? {})}
Whole-deck composition map: ${JSON.stringify(args.plan)}
Assigned slide IDs: ${args.targetSlideIds.join(", ")}
Use adjacent slides as rhythm/context only. Make assigned slides distinctive while obeying the shared visual DNA.`,
    },
  ];
}

export function curatorRecomposeInstruction(args: {
  slideId: string;
  neighboringPlan: PresentationPlanSlide[];
}): string {
  return `Recompose slide ${args.slideId} in place because its composition duplicates another slide. ` +
    "Use stable-element patch operations against exact components; preserve every fact, label, note, and slide ID. " +
    "Change spatial hierarchy, scale, visual device, or density enough to make it clearly distinct. " +
    "Keep decorative geometry out of readable text zones, route connectors through whitespace to their nodes, " +
    "and keep each diagram label visibly attached to its actual anchor. " +
    `Neighboring composition guidance: ${JSON.stringify(args.neighboringPlan)}.`;
}

export function curatorConsolidationInstruction(args: {
  survivorSlideId: string;
  duplicateSlides: Array<{ slideId: string; title: string; notes?: string; text: string }>;
}): string {
  return `Consolidate genuinely repeated content into survivor slide ${args.survivorSlideId} using in-place stable-element patches. ` +
    "Preserve every fact, number, source label, qualification, and speaker-note detail from all supplied slides. " +
    "Do not delete anything; the backend will delete duplicates only after deterministic content-retention validation. " +
    `Duplicate slide material: ${JSON.stringify(args.duplicateSlides)}.`;
}
