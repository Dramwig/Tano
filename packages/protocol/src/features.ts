// SPDX-License-Identifier: MIT
export type FeatureChannel = 'dev' | 'stable';
export type FeatureDefinition = { status: FeatureChannel; note: string };

export function defineFeatures<const T extends Record<string, FeatureDefinition>>(
  definitions: T,
): T {
  return definitions;
}

export function resolveFeatureChannel(env: {
  DEV?: boolean;
  VITE_TANO_CHANNEL?: string;
}): FeatureChannel {
  return env.DEV === true || env.VITE_TANO_CHANNEL === 'dev' ? 'dev' : 'stable';
}

export function createFeatureGate<T extends Record<string, FeatureDefinition>>(
  definitions: T,
  channel: FeatureChannel,
) {
  return {
    isEnabled(id: keyof T): boolean {
      if (!Object.hasOwn(definitions, id)) throw new Error(`Unknown feature: ${String(id)}`);
      return definitions[id].status === 'stable' || channel === 'dev';
    },
  };
}
