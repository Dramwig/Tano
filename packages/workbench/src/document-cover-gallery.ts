import catalog from './assets/covers/catalog.json';
import { documentCovers } from './document-appearance';

export interface DocumentCover {
  value: string;
  label: string;
  background?: string;
  image?: string;
  thumbnail?: string;
  artist?: string;
  date?: string;
  objectPosition?: string;
  presentation?: 'specimen';
}

// Vite emits bundled assets for both the browser demo and offline desktop builds.
// Only the stable preset ID is saved in Markdown, never a build-specific asset URL.
const images = import.meta.glob<string>('./assets/covers/*.webp', { eager: true, query: '?url', import: 'default' });
const bundledGroups = catalog.groups.map(group => ({
  id: group.id,
  label: group.label,
  covers: group.artworks.map((artwork): DocumentCover => ({
    value: artwork.id,
    label: artwork.title,
    artist: artwork.artist,
    date: artwork.date,
    objectPosition: 'objectPosition' in artwork ? artwork.objectPosition : undefined,
    background: 'background' in artwork ? artwork.background : undefined,
    presentation: 'presentation' in artwork && artwork.presentation === 'specimen' ? 'specimen' : undefined,
    image: images[`./assets/covers/${artwork.image}`],
    thumbnail: images[`./assets/covers/${artwork.thumbnail}`],
  })),
}));

// Curating the picker must not invalidate IDs already saved in Markdown.
// Keep the complete asset registry, including retired NASA and portrait covers.
const coversById = new Map<string, DocumentCover>([
  ...documentCovers, ...bundledGroups.flatMap(group => group.covers),
].map(cover => [cover.value, cover]));
const galleryIds = new Set(catalog.gallery.artworkIds);
export const documentCoverGroups: { id: string; label: string; covers: readonly DocumentCover[] }[] = [
  { id: 'colors', label: '颜色和渐变', covers: documentCovers },
  ...bundledGroups.map(group => ({
    ...group,
    covers: group.covers.filter(cover => galleryIds.has(cover.value)),
  })).filter(group => group.covers.length > 0),
];

export function documentCoverPreset(value: string): DocumentCover | undefined {
  return coversById.get(value);
}
