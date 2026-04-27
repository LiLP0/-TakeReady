import type { ScriptChunk } from '../types/script';

export type ScriptChunkMetadataDefaults = Omit<
  ScriptChunk,
  'emojiCue' | 'endIndex' | 'id' | 'sectionId' | 'startIndex' | 'text'
>;

export function getDefaultChunkMetadata(): ScriptChunkMetadataDefaults {
  return {
    brollNote: '',
    deliveryNote: '',
    editNote: '',
    goodTake: false,
    pauseAfter: false,
    tone: 'neutral',
    type: 'POINT',
  };
}
