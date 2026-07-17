import { z } from "zod";
import type { PresentationTypographyRoles } from "./types";

const fontFamily = z.string().trim().min(1).max(120)
  .regex(/^[A-Za-z0-9 ,_-]+$/, "Use a safe CSS font stack without quotes or punctuation.");
const fontWeight = z.number().int().min(100).max(900)
  .refine((value) => value % 100 === 0, "Font weight must use a 100-point increment.");
const typographyTokenSchema = z.object({
  fontFamily,
  fontWeight,
}).strict();

export const presentationTypographyRolesSchema = z.object({
  displayTitle: typographyTokenSchema,
  slideTitle: typographyTokenSchema,
  body: typographyTokenSchema,
  label: typographyTokenSchema,
  kicker: typographyTokenSchema,
  sequenceNumber: typographyTokenSchema,
  footer: typographyTokenSchema,
}).strict();

export const defaultPresentationTypographyRoles: PresentationTypographyRoles = {
  displayTitle: { fontFamily: "Georgia, serif", fontWeight: 700 },
  slideTitle: { fontFamily: "Arial, sans-serif", fontWeight: 700 },
  body: { fontFamily: "Arial, sans-serif", fontWeight: 400 },
  label: { fontFamily: "Arial, sans-serif", fontWeight: 600 },
  kicker: { fontFamily: "Arial, sans-serif", fontWeight: 700 },
  sequenceNumber: { fontFamily: "Georgia, serif", fontWeight: 700 },
  footer: { fontFamily: "Arial, sans-serif", fontWeight: 400 },
};
