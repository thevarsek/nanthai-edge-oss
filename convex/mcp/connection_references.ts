import type { MutationCtx } from "../_generated/server";

export const connectionReferenceCleanupPhases = [
  "preferences",
  "personas",
  "chats",
  "skills",
  "scheduledJobs",
] as const;

export type ConnectionReferenceCleanupPhase =
  (typeof connectionReferenceCleanupPhases)[number];

export type ConnectionReferenceCleanupState = {
  phase: ConnectionReferenceCleanupPhase;
  cursor?: string;
};

const pageSize = 50;

type IntegrationOverride = {
  integrationId: string;
  enabled: boolean;
};

function withoutIntegrationId(
  values: string[] | undefined,
  integrationId: string,
): string[] | undefined {
  if (!values?.includes(integrationId)) return values;
  const filtered = values.filter((value) => value !== integrationId);
  return filtered.length > 0 ? filtered : undefined;
}

function withoutIntegrationOverride(
  values: IntegrationOverride[] | undefined,
  integrationId: string,
): IntegrationOverride[] | undefined {
  if (!values?.some((value) => value.integrationId === integrationId)) return values;
  const filtered = values.filter((value) => value.integrationId !== integrationId);
  return filtered.length > 0 ? filtered : undefined;
}

function nextPhase(
  phase: ConnectionReferenceCleanupPhase,
): ConnectionReferenceCleanupPhase | undefined {
  const index = connectionReferenceCleanupPhases.indexOf(phase);
  return connectionReferenceCleanupPhases[index + 1];
}

export async function cleanupConnectionReferencePage(
  ctx: Pick<MutationCtx, "db">,
  args: {
    userId: string;
    integrationId: string;
    state?: ConnectionReferenceCleanupState;
  },
): Promise<ConnectionReferenceCleanupState | undefined> {
  const phase = args.state?.phase ?? "preferences";
  const cursor = args.state?.cursor;

  if (phase === "preferences") {
    const preferences = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (query) => query.eq("userId", args.userId))
      .first();
    const integrationDefaults = withoutIntegrationOverride(
      preferences?.integrationDefaults,
      args.integrationId,
    );
    if (preferences && integrationDefaults !== preferences.integrationDefaults) {
      await ctx.db.patch(preferences._id, {
        integrationDefaults,
        updatedAt: Date.now(),
      });
    }
    return { phase: "personas" };
  }

  if (phase === "personas") {
    const page = await ctx.db
      .query("personas")
      .withIndex("by_user", (query) => query.eq("userId", args.userId))
      .paginate({ cursor: cursor ?? null, numItems: pageSize });
    for (const persona of page.page) {
      const integrationOverrides = withoutIntegrationOverride(
        persona.integrationOverrides,
        args.integrationId,
      );
      if (integrationOverrides !== persona.integrationOverrides) {
        await ctx.db.patch(persona._id, { integrationOverrides, updatedAt: Date.now() });
      }
    }
    return page.isDone
      ? { phase: "chats" }
      : { phase, cursor: page.continueCursor };
  }

  if (phase === "chats") {
    const page = await ctx.db
      .query("chats")
      .withIndex("by_user", (query) => query.eq("userId", args.userId))
      .paginate({ cursor: cursor ?? null, numItems: pageSize });
    for (const chat of page.page) {
      const integrationOverrides = withoutIntegrationOverride(
        chat.integrationOverrides,
        args.integrationId,
      );
      if (integrationOverrides !== chat.integrationOverrides) {
        // Do not change updatedAt: it is part of this pagination index.
        await ctx.db.patch(chat._id, { integrationOverrides });
      }
    }
    return page.isDone
      ? { phase: "skills" }
      : { phase, cursor: page.continueCursor };
  }

  if (phase === "skills") {
    const page = await ctx.db
      .query("skills")
      .withIndex("by_owner", (query) => query.eq("ownerUserId", args.userId))
      .paginate({ cursor: cursor ?? null, numItems: pageSize });
    for (const skill of page.page) {
      if (!skill.requiredIntegrationIds.includes(args.integrationId)) continue;
      await ctx.db.patch(skill._id, {
        requiredIntegrationIds: skill.requiredIntegrationIds.filter(
          (integrationId) => integrationId !== args.integrationId,
        ),
        updatedAt: Date.now(),
      });
    }
    return page.isDone
      ? { phase: "scheduledJobs" }
      : { phase, cursor: page.continueCursor };
  }

  const page = await ctx.db
    .query("scheduledJobs")
    .withIndex("by_user", (query) => query.eq("userId", args.userId))
    .paginate({ cursor: cursor ?? null, numItems: pageSize });
  for (const job of page.page) {
    const enabledIntegrations = withoutIntegrationId(
      job.enabledIntegrations,
      args.integrationId,
    );
    const turnIntegrationOverrides = withoutIntegrationOverride(
      job.turnIntegrationOverrides,
      args.integrationId,
    );
    const steps = job.steps?.map((step) => ({
      ...step,
      enabledIntegrations: withoutIntegrationId(
        step.enabledIntegrations,
        args.integrationId,
      ),
      turnIntegrationOverrides: withoutIntegrationOverride(
        step.turnIntegrationOverrides,
        args.integrationId,
      ),
    }));
    const stepsChanged = steps?.some((step, index) => {
      const previous = job.steps?.[index];
      return previous
        && (step.enabledIntegrations !== previous.enabledIntegrations
          || step.turnIntegrationOverrides !== previous.turnIntegrationOverrides);
    }) === true;
    if (
      enabledIntegrations !== job.enabledIntegrations
      || turnIntegrationOverrides !== job.turnIntegrationOverrides
      || stepsChanged
    ) {
      await ctx.db.patch(job._id, {
        enabledIntegrations,
        turnIntegrationOverrides,
        steps: stepsChanged ? steps : job.steps,
        updatedAt: Date.now(),
      });
    }
  }
  if (!page.isDone) return { phase, cursor: page.continueCursor };
  const followingPhase = nextPhase(phase);
  return followingPhase ? { phase: followingPhase } : undefined;
}
