import catalog from '../assets/covers/catalog.json';
import { documentCovers } from './document-appearance';
import { DEFAULT_DOCUMENT_COVER_BASE_URL, resolveDocumentCoverBaseUrl } from '../runtime';

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

const FALLBACK_GRADIENTS: Record<string, string> = {
  patterns: 'linear-gradient(125deg, #d7dfd6, #e6e8df 52%, #c3cfc4)',
  'chinese-scrolls': 'linear-gradient(130deg, #cad7cf, #e5e2d5 54%, #b2c5bb)',
  landscapes: 'linear-gradient(130deg, #b8cde0, #dde5ec 52%, #c9c7b8)',
  gardens: 'linear-gradient(130deg, #cbe0ce, #ece9d7 55%, #d9c8b4)',
  'ukiyo-e': 'linear-gradient(135deg, #b7cad9, #e5dfd2 55%, #d6b6a5)',
  flowers: 'linear-gradient(130deg, #e5d8d2, #efe9e0 55%, #c9d2c4)',
  'fruit-watercolors': 'linear-gradient(130deg, #ece3d5, #f5f0e6 55%, #dfd2bf)',
};
const DEFAULT_ARTWORK_FALLBACK = 'linear-gradient(125deg, #dce5df, #ecebe3 55%, #ced6cf)';

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl ?? DEFAULT_DOCUMENT_COVER_BASE_URL).trim();
  return (raw || DEFAULT_DOCUMENT_COVER_BASE_URL).replace(/\/+$/, '');
}

// Curated artwork covers are served over HTTPS from the public static asset host
// (with deterministic CSS-gradient fallback when offline). Only the stable preset
// ID is ever saved in Markdown frontmatter, never a deployment-specific URL.
function buildArtworkGroups(baseUrl?: string) {
  const base = normalizeBaseUrl(baseUrl);
  return catalog.groups.map((group) => {
    const fallbackBackground = FALLBACK_GRADIENTS[group.id] ?? DEFAULT_ARTWORK_FALLBACK;
    return {
      id: group.id,
      label: group.label,
      covers: group.artworks.map((artwork): DocumentCover => ({
        value: artwork.id,
        label: artwork.title,
        artist: artwork.artist,
        date: artwork.date,
        objectPosition: 'objectPosition' in artwork ? artwork.objectPosition : undefined,
        background:
          ('background' in artwork && artwork.background) ? artwork.background : fallbackBackground,
        presentation:
          'presentation' in artwork && artwork.presentation === 'specimen' ? 'specimen' : undefined,
        image: `${base}/${artwork.image}`,
        thumbnail: `${base}/${artwork.thumbnail}`,
      })),
    };
  });
}

const galleryIds = new Set(catalog.gallery.artworkIds);

const cacheByBase = new Map<
  string,
  {
    groups: { id: string; label: string; covers: readonly DocumentCover[] }[];
    byId: Map<string, DocumentCover>;
  }
>();

function registryForBase(baseUrl?: string) {
  const base = normalizeBaseUrl(baseUrl);
  const cached = cacheByBase.get(base);
  if (cached) return cached;
  const artworkGroups = buildArtworkGroups(base);
  const byId = new Map<string, DocumentCover>(
    [...documentCovers, ...artworkGroups.flatMap((group) => group.covers)].map((cover) => [
      cover.value,
      cover,
    ]),
  );
  const groups = [
    { id: 'colors', label: '颜色和渐变', covers: documentCovers },
    ...artworkGroups
      .map((group) => ({
        ...group,
        covers: group.covers.filter((cover) => galleryIds.has(cover.value)),
      }))
      .filter((group) => group.covers.length > 0),
  ];
  const entry = { groups, byId };
  cacheByBase.set(base, entry);
  return entry;
}

export function getDocumentCoverGroups(
  baseUrl?: string,
): { id: string; label: string; covers: readonly DocumentCover[] }[] {
  return registryForBase(baseUrl ?? resolveDocumentCoverBaseUrl()).groups;
}

export const documentCoverGroups: { id: string; label: string; covers: readonly DocumentCover[] }[] =
  registryForBase(DEFAULT_DOCUMENT_COVER_BASE_URL).groups;

// Curating the picker must not invalidate IDs already saved in Markdown.
// Keep the complete asset registry, including retired NASA and portrait covers.
export function documentCoverPreset(value: string, baseUrl?: string): DocumentCover | undefined {
  return registryForBase(baseUrl ?? resolveDocumentCoverBaseUrl()).byId.get(value);
}
