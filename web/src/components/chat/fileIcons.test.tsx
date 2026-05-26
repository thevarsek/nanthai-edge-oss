import {
  FileArchive,
  FileAudio2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  Presentation,
} from "lucide-react";
import { describe, expect, it } from "vitest";
import { getFileIconComponent } from "./fileIcons";

describe("getFileIconComponent", () => {
  it("maps common MIME families to dedicated icons", () => {
    expect(getFileIconComponent("image/png")).toBe(FileImage);
    expect(getFileIconComponent("audio/mpeg")).toBe(FileAudio2);
    expect(getFileIconComponent("video/mp4")).toBe(FileVideo2);
    expect(getFileIconComponent("text/csv")).toBe(FileSpreadsheet);
    expect(getFileIconComponent("application/pdf")).toBe(FileText);
    expect(getFileIconComponent("application/vnd.ms-powerpoint")).toBe(Presentation);
    expect(getFileIconComponent("application/zip")).toBe(FileArchive);
  });
});
