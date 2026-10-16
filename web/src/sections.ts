import type { SectionKind } from "./api";

export const KIND_LABELS: Record<SectionKind, string> = {
  lecture: "Lecture",
  lab: "Lab",
  tutorial: "Tutorial",
};

// "012, 15  021" → ["012", "15", "021"]. The server pads and validates each one.
export function parseSectionList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
