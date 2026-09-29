// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoAdapter } from './adapter';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('keeps deleted demo document and imported object IDs reserved after reopening', async () => {
  const adapter = new DemoAdapter();
  const first = (await adapter.open()).files.find((file) => file.kind === 'file')!;
  await adapter.remove(first.path);
  const object = {
    version: 1,
    id: 'a82f91',
    type: 'person',
    name: 'Alice',
    description: '',
    archived: false,
    properties: {},
  };
  await adapter.create('person.tano.json', JSON.stringify(object));
  await adapter.remove('person.tano.json');
  const reopened = new DemoAdapter();
  const random = vi.spyOn(crypto, 'getRandomValues');
  random.mockImplementationOnce((bytes: any) => {
    bytes.set(first.id.match(/../g)!.map((byte) => parseInt(byte, 16)));
    return bytes;
  });
  random.mockImplementationOnce((bytes: any) => {
    bytes.set([0xa8, 0x2f, 0x91]);
    return bytes;
  });
  const id = await reopened.reserveObjectId();
  expect(id).toMatch(/^[0-9a-f]{6}$/);
  expect(id).not.toBe(first.id);
  expect(id).not.toBe(object.id);
  expect(random.mock.calls.length).toBeGreaterThanOrEqual(3);
});
