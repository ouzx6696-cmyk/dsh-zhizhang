import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { arr, int, lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";

export const BookPipelineReq = obj({
  title: str({ min: 1 }),
  premise: str({ min: 1 }),
  genre: opt(str()),
  grade: opt(lit("economy", "standard", "premium")),
  outlineCount: opt(int({ min: 1, max: 100 })),
});

export type BookReq = Infer<typeof BookPipelineReq>;

export interface BookCardOutput {
  title: string;
  genre: string;
  hook: string;
  sellingPoints: string[];
  targetAudience: string;
}

export interface BookFoundationOutput {
  protagonist: { name: string; goal: string; flaw: string; goldenFinger: string };
  worldview: string;
  powerSystem: string;
  coreConflict: string;
}

export interface BookVolume {
  volume: number;
  title: string;
  summary: string;
  startChapter: number;
  endChapter: number;
}

export interface BookStructureOutput {
  volumes: BookVolume[];
}

export interface ChapterOutlineItem {
  position: number;
  title: string;
  synopsis: string;
  conflict: string;
  hook: string;
}

export interface BookOutlineOutput {
  chapters: ChapterOutlineItem[];
}

export interface BookPlanResult {
  card: BookCardOutput;
  foundation: BookFoundationOutput;
  structure: BookStructureOutput;
  outline: BookOutlineOutput;
  outlineCount: number;
}

export interface BookPipelineState extends Record<string, unknown> {
  card?: BookCardOutput;
  foundation?: BookFoundationOutput;
  structure?: BookStructureOutput;
  outline?: BookOutlineOutput;
  result?: BookPlanResult;
}

export const BookCardSchema = obj({
  title: str({ min: 1 }),
  genre: str({ min: 1 }),
  hook: str({ min: 1 }),
  sellingPoints: arr(str({ min: 1 }), { max: 10 }),
  targetAudience: str({ min: 1 }),
});

export const BookCardFileSchema = obj(
  {
    format: lit(FORMAT_VERSION),
    title: str({ min: 1 }),
    genre: str({ min: 1 }),
    hook: str({ min: 1 }),
    sellingPoints: arr(str({ min: 1 }), { max: 10 }),
    targetAudience: str({ min: 1 }),
  },
  { strict: false },
);

export const BookFoundationSchema = obj({
  protagonist: obj({
    name: str({ min: 1 }),
    goal: str({ min: 1 }),
    flaw: str({ min: 1 }),
    goldenFinger: str({ min: 1 }),
  }),
  worldview: str({ min: 1 }),
  powerSystem: str({ min: 1 }),
  coreConflict: str({ min: 1 }),
});

export const BookVolumeSchema = obj({
  volume: int({ min: 1 }),
  title: str({ min: 1 }),
  summary: str({ min: 1 }),
  startChapter: int({ min: 1 }),
  endChapter: int({ min: 1 }),
});

export const BookStructureSchema = obj({
  volumes: arr(BookVolumeSchema, { max: 30 }),
});

export const ChapterOutlineSchema = obj({
  position: int({ min: 1 }),
  title: str({ min: 1 }),
  synopsis: str({ min: 1 }),
  conflict: str({ min: 1 }),
  hook: str({ min: 1 }),
});

export const BookOutlineSchema = obj({
  chapters: arr(ChapterOutlineSchema, { max: 100 }),
});
