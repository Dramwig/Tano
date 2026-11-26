import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import vectors from '../protocol-vectors.json';
import {
  annotationDirectory,
  assistantRulesPath,
  discussionDirectory,
  isShortId,
  isWorkspaceDataPath,
  isWorkspaceInternalPath,
  objectDirectory,
  templateDirectory,
  workspaceCapabilityPath,
  workspaceDataDirectory,
  workspaceFolderRegistryPath,
  workspacePluginPath,
  workspaceRelationPath,
  workspaceSettingsPath,
  workspaceViewDirectory,
} from './index';

it('matches shared cross-language protocol constants and vectors', () => {
  expect(workspaceDataDirectory).toBe(vectors.constants.WORKSPACE_DATA_DIRECTORY);
  expect(objectDirectory).toBe(vectors.constants.OBJECT_DIRECTORY);
  expect(workspaceCapabilityPath).toBe(vectors.constants.WORKSPACE_CAPABILITY_PATH);
  expect(workspaceFolderRegistryPath).toBe(vectors.constants.WORKSPACE_FOLDER_REGISTRY_PATH);
  expect(workspaceSettingsPath).toBe(vectors.constants.WORKSPACE_SETTINGS_PATH);
  expect(workspacePluginPath).toBe(vectors.constants.WORKSPACE_PLUGIN_PATH);
  expect(workspaceRelationPath).toBe(vectors.constants.WORKSPACE_RELATION_PATH);
  expect(assistantRulesPath).toBe(vectors.constants.ASSISTANT_RULES_PATH);
  expect(annotationDirectory).toBe(vectors.constants.ANNOTATION_DIRECTORY);
  expect(discussionDirectory).toBe(vectors.constants.DISCUSSION_DIRECTORY);
  expect(templateDirectory).toBe(vectors.constants.TEMPLATE_DIRECTORY);
  expect(workspaceViewDirectory).toBe(vectors.constants.WORKSPACE_VIEW_DIRECTORY);

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
