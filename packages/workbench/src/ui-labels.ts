import { dataFieldTypes, referenceTypeLabel, objectTypeRegistry } from '@tano/protocol';
import type { DataFieldType } from '@tano/protocol';
import { t } from './i18n';

/** Presentation wrappers keep shared schema labels and saved values unchanged. */
export const localizedDataFieldTypes = Object.defineProperties({}, Object.fromEntries(
  Object.entries(dataFieldTypes).map(([key, label]) => [key, { enumerable: true, get: () => t(label) }]),
)) as Readonly<Record<DataFieldType, string>>;

export function objectTypeLabel(type: string): string {
  const label = referenceTypeLabel(type);
  return objectTypeRegistry.get(type)?.category === 'core' ? t(label) : label;
}
