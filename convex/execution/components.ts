import { WorkflowManager } from "@convex-dev/workflow";
import { Workpool } from "@convex-dev/workpool";
import { components } from "../_generated/api";

export const executionParallelism = {
  workflow: 10,
  interactive: 6,
  background: 3,
  maintenance: 1,
} as const;

export const durableWorkflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: executionParallelism.workflow,
    retryActionsByDefault: false,
  },
});

export const interactiveWorkpool = new Workpool(components.interactiveWorkpool, {
  maxParallelism: executionParallelism.interactive,
  retryActionsByDefault: false,
});

export const backgroundWorkpool = new Workpool(components.backgroundWorkpool, {
  maxParallelism: executionParallelism.background,
  retryActionsByDefault: false,
});

export const maintenanceWorkpool = new Workpool(components.maintenanceWorkpool, {
  maxParallelism: executionParallelism.maintenance,
  retryActionsByDefault: false,
});
