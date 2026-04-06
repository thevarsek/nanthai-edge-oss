import { v, type PropertyValidators } from "convex/values";
import {
  memoryCategory,
  memoryRetrievalMode,
  memoryScopeType,
} from "../schema_validators";

export const listArgs = {
  limit: v.optional(v.number()),
  pinnedOnly: v.optional(v.boolean()),
} satisfies PropertyValidators;

const personaIdsValidator = v.optional(v.array(v.string()));
const tagsValidator = v.optional(v.array(v.string()));

export const togglePinArgs = {
  memoryId: v.id("memories"),
} satisfies PropertyValidators;

export const removeArgs = {
  memoryId: v.id("memories"),
} satisfies PropertyValidators;

export const approveArgs = {
  memoryId: v.id("memories"),
} satisfies PropertyValidators;

export const rejectArgs = {
  memoryId: v.id("memories"),
} satisfies PropertyValidators;

export const updateArgs = {
  memoryId: v.id("memories"),
  content: v.optional(v.string()),
  category: v.optional(memoryCategory),
  retrievalMode: v.optional(memoryRetrievalMode),
  scopeType: v.optional(memoryScopeType),
  personaIds: personaIdsValidator,
  tags: tagsValidator,
} satisfies PropertyValidators;

export const createManualArgs = {
  content: v.string(),
  category: v.optional(memoryCategory),
  retrievalMode: v.optional(memoryRetrievalMode),
  scopeType: v.optional(memoryScopeType),
  personaIds: personaIdsValidator,
  tags: tagsValidator,
  isPinned: v.optional(v.boolean()),
} satisfies PropertyValidators;

const importFileValidator = v.object({
  storageId: v.id("_storage"),
  filename: v.string(),
  mimeType: v.string(),
  textContent: v.optional(v.string()),
});

export const extractImportCandidatesArgs = {
  files: v.array(importFileValidator),
  extractionModel: v.optional(v.string()),
  allowContactDetails: v.optional(v.boolean()),
} satisfies PropertyValidators;

export const importCandidateValidator = v.object({
  content: v.string(),
  category: v.optional(memoryCategory),
  retrievalMode: memoryRetrievalMode,
  scopeType: memoryScopeType,
  personaIds: personaIdsValidator,
  tags: tagsValidator,
  isPinned: v.optional(v.boolean()),
  sourceFileName: v.optional(v.string()),
  importanceScore: v.optional(v.number()),
  confidenceScore: v.optional(v.number()),
});

export const commitImportedMemoriesArgs = {
  memories: v.array(importCandidateValidator),
  isPending: v.optional(v.boolean()),
} satisfies PropertyValidators;

export const retrieveRelevantArgs = {
  queryText: v.string(),
  userId: v.string(),
  limit: v.optional(v.number()),
  // M23: Optional chat attribution for embedding cost tracking.
  chatId: v.optional(v.id("chats")),
  messageId: v.optional(v.id("messages")),
} satisfies PropertyValidators;

export const computeAndStoreEmbeddingArgs = {
  memoryId: v.id("memories"),
  content: v.string(),
} satisfies PropertyValidators;

export const getEmbeddingDocArgs = {
  embeddingId: v.id("memoryEmbeddings"),
} satisfies PropertyValidators;

export const getMemoryDocArgs = {
  memoryId: v.id("memories"),
} satisfies PropertyValidators;

export const storeEmbeddingArgs = {
  memoryId: v.id("memories"),
  userId: v.string(),
  embedding: v.array(v.float64()),
} satisfies PropertyValidators;

export const purgeUserMemoriesArgs = {
  userId: v.string(),
} satisfies PropertyValidators;
