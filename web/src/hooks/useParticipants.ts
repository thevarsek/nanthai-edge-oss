// hooks/useParticipants.ts
// Subscribes to chat participants from Convex and exposes CRUD mutations.
// Foundation for multi-participant support, @mention autocomplete, and
// the ChatParticipantPicker modal.

import { useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Participant } from "@/hooks/useChat";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Raw participant document from Convex chatParticipants table. */
export interface ChatParticipantDoc {
  _id: Id<"chatParticipants">;
  _creationTime: number;
  chatId: Id<"chats">;
  userId: string;
  modelId: string;
  personaId?: Id<"personas">;
  personaName?: string;
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
  sortOrder: number;
  createdAt: number;
}

/** A display-friendly participant with its Convex document ID. */
export interface ParticipantEntry {
  id: Id<"chatParticipants">;
  modelId: string;
  personaId?: Id<"personas"> | null;
  personaName?: string | null;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
  sortOrder: number;
}

/** Args for adding a participant via the Convex mutation. */
export interface AddParticipantArgs {
  chatId: Id<"chats">;
  modelId: string;
  personaId?: Id<"personas">;
  personaName?: string;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
  sortOrder?: number;
}

/** One entry in the setParticipants array. */
export interface SetParticipantEntry {
  modelId: string;
  personaId?: Id<"personas">;
  personaName?: string;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseParticipantsReturn {
  /** Sorted participant documents from Convex (empty array while loading). */
  participants: ParticipantEntry[];
  /** Raw docs for advanced use cases. */
  rawDocs: ChatParticipantDoc[];
  /** Whether the subscription is still loading. */
  isLoading: boolean;
  /** Participants mapped to the sendMessage Participant interface. */
  asMessageParticipants: Participant[];
  /** Add a participant (bare model or persona-backed). */
  addParticipant: (args: AddParticipantArgs) => Promise<Id<"chatParticipants">>;
  /** Remove a participant by its document ID. */
  removeParticipant: (participantId: Id<"chatParticipants">) => Promise<void>;
  /** Atomically replace all participants on the chat. */
  setParticipants: (
    chatId: Id<"chats">,
    entries: SetParticipantEntry[],
  ) => Promise<void>;
}

export function useParticipants(
  chatId: Id<"chats"> | null | undefined,
): UseParticipantsReturn {
  // ── Subscription ────────────────────────────────────────────────────────────
  const rawResult = useQuery(
    api.participants.queries.listByChat,
    chatId ? { chatId } : "skip",
  );

  const rawDocs = useMemo<ChatParticipantDoc[]>(
    () => (rawResult as ChatParticipantDoc[] | undefined) ?? [],
    [rawResult],
  );

  const isLoading = rawResult === undefined && chatId != null;

  // ── Mapped entries ──────────────────────────────────────────────────────────
  const participants = useMemo<ParticipantEntry[]>(
    () =>
      rawDocs.map((d) => ({
        id: d._id,
        modelId: d.modelId,
        personaId: d.personaId ?? null,
        personaName: d.personaName ?? null,
        personaEmoji: d.personaEmoji ?? null,
        personaAvatarImageUrl: d.personaAvatarImageUrl ?? null,
        sortOrder: d.sortOrder,
      })),
    [rawDocs],
  );

  /** Maps to the Participant shape expected by sendMessage. */
  const asMessageParticipants = useMemo<Participant[]>(
    () =>
      participants.map((p) => ({
        modelId: p.modelId,
        personaId: p.personaId,
        personaName: p.personaName,
        personaEmoji: p.personaEmoji,
        personaAvatarImageUrl: p.personaAvatarImageUrl,
      })),
    [participants],
  );

  // ── Mutations ───────────────────────────────────────────────────────────────
  const addMutation = useMutation(api.participants.mutations.addParticipant);
  const removeMutation = useMutation(
    api.participants.mutations.removeParticipant,
  );
  const setMutation = useMutation(api.participants.mutations.setParticipants);

  const addParticipant = useCallback(
    (args: AddParticipantArgs) => addMutation(args),
    [addMutation],
  );

  const removeParticipant = useCallback(
    async (participantId: Id<"chatParticipants">) => {
      await removeMutation({ participantId });
    },
    [removeMutation],
  );

  const setParticipants = useCallback(
    async (cId: Id<"chats">, entries: SetParticipantEntry[]) => {
      await setMutation({ chatId: cId, participants: entries });
    },
    [setMutation],
  );

  return {
    participants,
    rawDocs,
    isLoading,
    asMessageParticipants,
    addParticipant,
    removeParticipant,
    setParticipants,
  };
}
