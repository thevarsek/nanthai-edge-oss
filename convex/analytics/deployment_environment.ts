/** Unknown or unconfigured deployments must never look like production. */
export function deploymentAnalyticsProperties(environment = process.env.ANALYTICS_DEPLOYMENT_ENVIRONMENT): {
  deployment_environment: "production" | "development" | "unknown";
} {
  return { deployment_environment: environment === "production" || environment === "development"
    ? environment : "unknown" };
}
