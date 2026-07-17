import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import {
  createProject,
  deleteProject,
  deleteSlide,
  duplicateSlide,
  renameProject,
  reorderSlides,
  saveSlide,
} from "../presentations/mutations";
import { getProject, list } from "../presentations/queries";

type Row = Record<string, any>;

function buildCtx(rows: Record<string, Row[]>, userId: string | null = "user_1") {
  const query = (table: string) => {
    let filtered = rows[table] ?? [];
    let descending = false;
    const chain = {
      withIndex: (_index: string, apply?: (queryBuilder: any) => unknown) => {
        const filters: Array<[string, unknown]> = [];
        const builder = {
          eq: (field: string, value: unknown) => {
            filters.push([field, value]);
            return builder;
          },
        };
        apply?.(builder);
        filtered = (rows[table] ?? []).filter((row) =>
          filters.every(([field, value]) => row[field] === value),
        );
        return chain;
      },
      order: (direction: string) => {
        descending = direction === "desc";
        return chain;
      },
      first: async () => sorted()[0] ?? null,
      collect: async () => sorted(),
      take: async (count: number) => sorted().slice(0, count),
    };
    const sorted = () => [...filtered].sort((left, right) => {
      const key = table === "presentationSlides" ? "position" : "updatedAt";
      return (left[key] - right[key]) * (descending ? -1 : 1);
    });
    return chain;
  };

  return {
    auth: {
      getUserIdentity: async () => userId ? { subject: userId } : null,
    },
    db: {
      get: async (...args: unknown[]) => {
        const id = args.length === 2 ? args[1] : args[0];
        return Object.values(rows).flat().find((row) => row._id === id) ?? null;
      },
      query,
      insert: async (table: string, value: Row) => {
        const id = `${table}_${(rows[table]?.length ?? 0) + 1}`;
        rows[table] = rows[table] ?? [];
        rows[table].push({ _id: id, _creationTime: Date.now(), ...value });
        return id;
      },
      patch: async (...args: unknown[]) => {
        const id = args.length === 3 ? args[1] : args[0];
        const patch = args.length === 3 ? args[2] : args[1];
        const row = Object.values(rows).flat().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      },
      delete: async (...args: unknown[]) => {
        const id = args.length === 2 ? args[1] : args[0];
        for (const tableRows of Object.values(rows)) {
          const index = tableRows.findIndex((row) => row._id === id);
          if (index >= 0) tableRows.splice(index, 1);
        }
      },
    },
  } as any;
}

function project(overrides: Row = {}): Row {
  return {
    _id: "project_1",
    _creationTime: 1,
    userId: "user_1",
    title: "Original",
    status: "ready",
    sourceKind: "scratch",
    prompt: "Build a concise strategy deck",
    direction: "editorial",
    imageMode: "none",
    aspectRatio: "16:9",
    revision: 2,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function slide(id: string, position: number, overrides: Row = {}): Row {
  return {
    _id: `row_${id}`,
    _creationTime: 1,
    userId: "user_1",
    projectId: "project_1",
    slideId: id,
    position,
    title: id,
    html: `<section class="slide-root" style="position:relative;width:1280px;height:720px;overflow:hidden"><h1 data-element-id="headline_${position}" style="position:absolute;left:80px;top:80px">${id}</h1></section>`,
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function code(error: unknown): string | undefined {
  return error instanceof ConvexError ? (error.data as any)?.code : undefined;
}

test("project creation and queries enforce authentication and user ownership", async () => {
  const rows: Record<string, Row[]> = {
    presentationProjects: [project(), project({ _id: "foreign", userId: "user_2", updatedAt: 10 })],
    presentationSlides: [slide("slide_1", 0)],
  };
  await assert.rejects(
    () => (createProject as any)._handler(buildCtx(rows, null), {
      prompt: "A brief", direction: "minimal", imageMode: "none",
    }),
    (error: unknown) => code(error) === "AUTH_REQUIRED",
  );
  const created = await (createProject as any)._handler(buildCtx(rows), {
    title: "  New deck  ",
    prompt: "  Explain the market shift  ",
    direction: "data_led",
    imageMode: "none",
  });
  assert.equal(rows.presentationProjects.find((row) => row._id === created)?.title, "New deck");
  assert.equal(rows.presentationProjects.find((row) => row._id === created)?.prompt, "Explain the market shift");

  const listed = await (list as any)._handler(buildCtx(rows), {});
  assert.equal(listed.length, 2);
  assert.ok(listed.every((row: Row) => row.userId === "user_1"));
  assert.equal((await (getProject as any)._handler(buildCtx(rows), { projectId: "project_1" }))?.slides.length, 1);
  assert.equal(await (getProject as any)._handler(buildCtx(rows), { projectId: "foreign" }), null);
});

test("project creation enforces the same bounded library size that list exposes", async () => {
  const rows = {
    presentationProjects: Array.from({ length: 100 }, (_, index) => project({
      _id: `project_${index}`,
      updatedAt: index,
    })),
    presentationSlides: [] as Row[],
  };

  await assert.rejects(
    () => (createProject as any)._handler(buildCtx(rows), {
      prompt: "One deck too many",
      direction: "minimal",
      imageMode: "none",
    }),
    (error: unknown) => code(error) === "PROJECT_LIMIT",
  );
  assert.equal(rows.presentationProjects.length, 100);
});

test("renameProject validates ownership, title, busy state, and expected revision", async () => {
  const rows = { presentationProjects: [project()], presentationSlides: [] as Row[] };
  const renamed = await (renameProject as any)._handler(buildCtx(rows), {
    projectId: "project_1", title: "  Clear new title  ", expectedRevision: 2,
  });
  assert.equal(renamed.projectRevision, 3);
  assert.equal(rows.presentationProjects[0]?.title, "Clear new title");
  await assert.rejects(
    () => (renameProject as any)._handler(buildCtx(rows), {
      projectId: "project_1", title: "Stale", expectedRevision: 2,
    }),
    (error: unknown) => code(error) === "REVISION_CONFLICT",
  );
  rows.presentationProjects[0]!.status = "generating";
  await assert.rejects(
    () => (renameProject as any)._handler(buildCtx(rows), {
      projectId: "project_1", title: "Busy", expectedRevision: 3,
    }),
    (error: unknown) => code(error) === "PROJECT_BUSY",
  );
  await assert.rejects(
    () => (renameProject as any)._handler(buildCtx(rows, "user_2"), {
      projectId: "project_1", title: "Foreign", expectedRevision: 3,
    }),
    (error: unknown) => code(error) === "NOT_FOUND",
  );
});

test("saveSlide applies optimistic revisions and rejects foreign or stale writes", async () => {
  const rows = { presentationProjects: [project()], presentationSlides: [slide("slide_1", 0)] };
  const result = await (saveSlide as any)._handler(buildCtx(rows), {
    projectId: "project_1",
    slideId: "slide_1",
    expectedRevision: 0,
    title: "Updated",
    notes: null,
    html: slide("temp", 9).html,
  });
  assert.equal(result.slideRevision, 1);
  assert.equal(result.projectRevision, 3);
  await assert.rejects(
    () => (saveSlide as any)._handler(buildCtx(rows), {
      projectId: "project_1", slideId: "slide_1", expectedRevision: 0,
      title: "Stale", html: rows.presentationSlides[0]!.html,
    }),
    (error: unknown) => code(error) === "REVISION_CONFLICT",
  );
  await assert.rejects(
    () => (saveSlide as any)._handler(buildCtx(rows, "user_2"), {
      projectId: "project_1", slideId: "slide_1", expectedRevision: 1,
      title: "Foreign", html: rows.presentationSlides[0]!.html,
    }),
    (error: unknown) => code(error) === "NOT_FOUND",
  );
});

test("slide ordering, duplication, deletion, and project cascade stay contiguous", async () => {
  const rows = {
    presentationProjects: [project({ revision: 5 })],
    presentationSlides: [slide("slide_a", 0), slide("slide_b", 1), slide("slide_c", 2)],
  };
  const reordered = await (reorderSlides as any)._handler(buildCtx(rows), {
    projectId: "project_1", expectedProjectRevision: 5,
    orderedSlideIds: ["slide_c", "slide_a", "slide_b"],
  });
  assert.equal(reordered.projectRevision, 6);
  assert.deepEqual([...rows.presentationSlides].sort((a, b) => a.position - b.position).map((row) => row.slideId), ["slide_c", "slide_a", "slide_b"]);

  const duplicated = await (duplicateSlide as any)._handler(buildCtx(rows), {
    projectId: "project_1", slideId: "slide_a",
    expectedProjectRevision: 6, expectedSlideRevision: 1,
  });
  assert.match(duplicated.slideId, /^slide-/);
  assert.deepEqual([...rows.presentationSlides].sort((a, b) => a.position - b.position).map((row) => row.position), [0, 1, 2, 3]);
  await (deleteSlide as any)._handler(buildCtx(rows), {
    projectId: "project_1", slideId: duplicated.slideId,
    expectedProjectRevision: 7, expectedSlideRevision: 0,
  });
  assert.deepEqual([...rows.presentationSlides].sort((a, b) => a.position - b.position).map((row) => row.position), [0, 1, 2]);

  await assert.rejects(
    () => (deleteProject as any)._handler(buildCtx(rows), {
      projectId: "project_1", expectedRevision: 7,
    }),
    (error: unknown) => code(error) === "REVISION_CONFLICT",
  );
  await (deleteProject as any)._handler(buildCtx(rows), {
    projectId: "project_1", expectedRevision: 8,
  });
  assert.equal(rows.presentationProjects.length, 0);
  assert.equal(rows.presentationSlides.length, 0);
});

test("deleteSlide rejects stale callers and preserves the final slide", async () => {
  const rows = {
    presentationProjects: [project()],
    presentationSlides: [slide("slide_1", 0)],
  };
  await assert.rejects(
    () => (deleteSlide as any)._handler(buildCtx(rows), {
      projectId: "project_1", slideId: "slide_1",
      expectedProjectRevision: 1, expectedSlideRevision: 0,
    }),
    (error: unknown) => code(error) === "REVISION_CONFLICT",
  );
  await assert.rejects(
    () => (deleteSlide as any)._handler(buildCtx(rows), {
      projectId: "project_1", slideId: "slide_1",
      expectedProjectRevision: 2, expectedSlideRevision: 0,
    }),
    (error: unknown) => code(error) === "LAST_SLIDE",
  );
  assert.equal(rows.presentationSlides.length, 1);
});
