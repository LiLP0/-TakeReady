export type ScriptProject = {
  id: string;
  title: string;
  rawScript: string;

  // Raw script text used when chunk boundaries were created/edited.
  // Optional so older saved projects still compile.
  chunkSourceRawScript?: string;

  createdAt: string;
  updatedAt: string;
  sections: ScriptSection[];
  sessionNotes: SessionNote[];
};
