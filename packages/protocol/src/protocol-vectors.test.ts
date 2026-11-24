import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import vectors from '../protocol-vectors.json';
import {
  isShortId,
  isWorkspaceDataPath,
  isWorkspaceInternalPath,
  objectDirectory,
  workspaceCapabilityPath,
  workspaceDataDirectory,
  workspaceRelationPath,
  workspaceSettingsPath,
} from './index';

it('matches shared cross-language protocol constants and vectors', () => {
  expect(workspaceDataDirectory).toBe(vectors.constants.WORKSPACE_DATA_DIRECTORY);
  expect(objectDirectory).toBe(vectors.constants.OBJECT_DIRECTORY);
  expect(workspaceCapabilityPath).toBe(vectors.constants.WORKSPACE_CAPABILITY_PATH);
  expect(workspaceSettingsPath).toBe(vectors.constants.WORKSPACE_SETTINGS_PATH);
  expect(workspaceRelationPath).toBe(vectors.constants.WORKSPACE_RELATION_PATH);

  for (const item of vectors.hashes) {
    const actual = createHash('sha256').update(Buffer.from(item.input, 'utf8')).digest('hex');
    expect(actual, item.input).toBe(item.sha256);
  }
  for (const id of vectors.shortIds.valid) expect(isShortId(id), id).toBe(true);
  for (const id of vectors.shortIds.invalid) expect(isShortId(id), id).toBe(false);
  for (const path of vectors.workspaceInternalPaths.valid) expect(isWorkspaceInternalPath(path), path).toBe(true);
  for (const path of vectors.workspaceInternalPaths.invalid) expect(isWorkspaceInternalPath(path), path).toBe(false);
  for (const path of vectors.workspaceDataPaths.valid) expect(isWorkspaceDataPath(path), path).toBe(true);
  for (const path of vectors.workspaceDataPaths.invalid) expect(isWorkspaceDataPath(path), path).toBe(false);
});
