export type EntityId = string;

export type ISODateString = string;

export type ChunkType =
  | 'HOOK'
  | 'SETUP'
  | 'POINT'
  | 'JOKE'
  | 'PUNCHLINE'
  | 'TRANSITION'
  | 'RANT'
  | 'OUTRO'
  | 'B_ROLL_NOTE';

export type ToneTag =
  | 'neutral'
  | 'curious'
  | 'dry'
  | 'sarcastic'
  | 'deadpan'
  | 'confused'
  | 'fake_serious'
  | 'escalating';

export type ScriptFocusEmphasisStyle =
  | 'color'
  | 'underline'
  | 'color+underline';

export type ScriptFocusUnderlineStyle =
  | 'solid'
  | 'dotted'
  | 'dashed'
  | 'wavy';

export type ProjectCloudSyncState =
  | 'local_only'
  | 'syncing'
  | 'synced'
  | 'sync_error';

export interface ScriptChunk {
  id: EntityId;
  text: string;
  startIndex: number;
  endIndex: number;
  sectionId?: ScriptSection['id'];
  type: ChunkType;
  tone: ToneTag;
  deliveryNote: string;
  editNote: string;
  brollNote: string;
  emojiCue?: string;
  pauseAfter: boolean;
  goodTake: boolean;
}

export interface ScriptSection {
  id: EntityId;
  title: string;
  description: string;
  chunks: ScriptChunk[];
}

export interface SessionNote {
  id: EntityId;
  text: string;
  createdAt: ISODateString;
  sectionId?: ScriptSection['id'];
  chunkId?: ScriptChunk['id'];
}

export interface ScriptProject {
  id: EntityId;
  title: string;
  rawScript: string;
  chunkSourceRawScript: string;
  googleDriveFileId?: string;
  cloudSyncState: ProjectCloudSyncState;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  sections: ScriptSection[];
  sessionNotes: SessionNote[];
}

export interface ScriptFocusModeSettings {
  enabled: boolean;
  emphasizedPortion: number;
  minimumWordLength: number;
  frequency: number;
  emphasisStyle: ScriptFocusEmphasisStyle;
  emphasisColor: string;
  underlineStyle: ScriptFocusUnderlineStyle;
  underlineThickness: number;
  ignoreShortFunctionWords: boolean;
  applyToNumbers: boolean;
}
