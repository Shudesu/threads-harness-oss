export type MediaItem = { type: 'IMAGE' | 'VIDEO'; url: string };
export function validMediaUrl(value: unknown): boolean;
export function validMedia(media: unknown): media is MediaItem[];
export function validDraftContent(text: unknown, media?: unknown): boolean;
