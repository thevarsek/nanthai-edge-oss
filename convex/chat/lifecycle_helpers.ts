type FinalMessageStatus = "completed" | "failed" | "cancelled";
type FinalJobStatus = "completed" | "failed" | "cancelled";

export function mapFinalMessageStatusToJobStatus(
  status: FinalMessageStatus,
): FinalJobStatus {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}
