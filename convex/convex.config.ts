import { defineApp } from "convex/server";
import workflow from "@convex-dev/workflow/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();
app.use(workflow);
app.use(workpool, { name: "interactiveWorkpool" });
app.use(workpool, { name: "backgroundWorkpool" });
app.use(workpool, { name: "maintenanceWorkpool" });

export default app;
