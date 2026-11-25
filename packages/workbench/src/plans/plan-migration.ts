import { isActionableTask, isPlanCompleted, parseTaskRepeat } from '@tano/protocol';
import type { WorkspaceObject } from '@tano/protocol';
import type { ObjectRecord } from '../objects/workspace-objects';
import type { PlanScope } from '../stores/plans';

const STRIPPED_KEYS = [
  'syncConnection',
  'syncRemoteId',
  'syncReadOnly',
  'syncConflictCopy',
  'deliveryReview',
  'repeatSourceId',
  'repeatOccurrence',
  'repeatVirtual',
] as const;

export interface PlanMigrationResult {
  created: ObjectRecord;
  archivedSource: boolean;
  warning?: string;
}

export function prepareMigratedObject(
  source: WorkspaceObject,
  targetScope: PlanScope,
): Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'archived' | 'properties'> {
  const properties: Record<string, unknown> = JSON.parse(JSON.stringify(source.properties));
  for (const key of STRIPPED_KEYS) delete properties[key];

  // Canonicalize legacy `task` -> `event` with `checkable: true` on migration.
  const checkable = isActionableTask(source);
  const completed = isPlanCompleted(source);
  properties.checkable = checkable;
  properties.completed = completed;

  // Personal scope only runs calendar schedule recurrence, not workspace after_complete instances.
  if (targetScope === 'personal' && properties.repeat !== undefined) {
    try {
      const rule = parseTaskRepeat(properties.repeat);
      if (rule.mode !== 'schedule') {
        properties.repeat = { ...rule, mode: 'schedule' };
      }
    } catch {
      delete properties.repeat;
    }
  }

  return {
    type: 'event',
    name: source.name,
    description: source.description,
    archived: false,
    properties,
  };
}

/**
 * Moves a plan item between Personal and Workspace safely:
 * 1. Create the cleaned copy in the destination scope.
 * 2. Archive the original record only after creation succeeds.
 * If archiving fails, the newly created copy is preserved and a warning is returned.
 */
export async function movePlanBetweenScopes(
  record: ObjectRecord,
  targetScope: PlanScope,
  ports: {
    workspaceId?: string;
    create: (
      value: Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'archived' | 'properties'>,
      scope: PlanScope,
      workspaceId?: string,
    ) => Promise<ObjectRecord>;
    archive: (source: ObjectRecord) => Promise<unknown>;
  },
): Promise<PlanMigrationResult> {
  const currentScope: PlanScope = record.source?.scope === 'personal' ? 'personal' : 'workspace';
  if (currentScope === targetScope) {
    throw new Error('事项已在目标空间中');
  }
  if (targetScope === 'workspace' && !ports.workspaceId) {
    throw new Error('请先打开目标工作区');
  }
  const payload = prepareMigratedObject(record.object, targetScope);
  const created = await ports.create(payload, targetScope, ports.workspaceId);
  try {
    await ports.archive(record);
    return { created, archivedSource: true };
  } catch (reason) {
    return {
      created,
      archivedSource: false,
      warning: `已复制到目标空间，但原记录归档失败：${String(reason)}`,
    };
  }
}
