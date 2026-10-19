import { expect, it } from 'vitest';
import { validatePath, validateStoragePath } from './index';

it('allows only portable platform files through storage while keeping user paths hidden-free', () => {
  for (const path of [
    '.tano/objects/a00001.tano.json',
    '.tano/objects/nested/copy.tano.json',
    '.tano/capabilities.json',
    '.tano/settings.tano.json',
    '.tano/relations.tano-relations.json',
    '.tano/conflicts/object.json',
    '.tano/annotations/a00001.tano.json',
    '.tano/discussions/a00001.tano.json',
    '.tano/document-layout/a00001.tano.json',
    '.tano/rules/assistant.md',
    '.tano/templates/a00001.md',
    '.tano/views/research.tano.json',
  ]) {
    expect(validateStoragePath(path), path).toBeNull();
    expect(validatePath(path), path).not.toBeNull();
  }
  for (const path of [
    '.tano',
    '.tano/objects',
    '.tano/config.json',
    '.workspace/config.json',
    '.workspace/objects/a00001.tano.json',
    '.workspace/capabilities.json',
    '.workspace/relations.tano-relations.json',
    '.workspace/conflicts/object.json',
    '.workspace/private.json',
    '.workspace/objects/../config.tano.json',
    '.tano/private.json',
    '.tano/templates/not-an-id.md',
    '.tano/templates/a00001.json',
    '.tano/views/not-a-view.json',
    '.tano/views/research.tano.json.bak',
    '.tano/templates/../secret.md',
    '.tano/rules/secrets.md',
    '.tano/rules/../assistant.md',
    '.tano/objects/../config.tano.json',
    '.tano/objects/.secret/a.tano.json',
    '.tano/objects/CON.tano.json',
    '.tano/objects/a.md',
    '.tano/annotations/not-an-id.tano.json',
    '.tano/discussions/a00001.md',
    '.tano/document-layout/not-an-id.tano.json',
    '.tano/document-layout/a00001.md',
    'x/.tano/objects/a.tano.json',
    '.Tano/objects/a.tano.json',
    '.git/config',
    '.tano/objects/a\\b.tano.json',
  ])
    expect(validateStoragePath(path), path).not.toBeNull();
  expect(validateStoragePath('notes/a.md')).toBeNull();
});
