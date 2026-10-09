import { expect, it } from 'vitest';
import { assertPluginConnectionRequest, parsePluginConnectionInput, parsePluginConnectionRequest } from './plugin-connections';

const input = { pluginId: 'example', origin: 'https://api.example.com', integrity: 'a'.repeat(64), methods: ['GET'], pathPrefix: '/v1/', authentication: 'bearer', secret: 'test-key-only' };
it('validates credential scope separately from request content', () => {
  const connection = parsePluginConnectionInput(input);
  expect(() => assertPluginConnectionRequest(connection, parsePluginConnectionRequest({ path: '/v1/items?limit=10' }))).not.toThrow();
  for (const path of ['/v10/items', '/v1/../private', '/private']) expect(() => assertPluginConnectionRequest(connection, parsePluginConnectionRequest({ path }))).toThrow();
  expect(() => assertPluginConnectionRequest(connection, parsePluginConnectionRequest({ path: '/v1/items', method: 'DELETE' }))).toThrow();
  for (const path of ['//other.example/path', '/v1/%252e%252e/private', '/v1/%2fprivate', '/v1/\\private', '/v1/%09../private', '/v1/%00private', '/v1/items#fragment']) expect(() => parsePluginConnectionRequest({ path })).toThrow();
  expect(() => parsePluginConnectionRequest({ path: '/v1/', method: 'GET', body: {} })).toThrow();
  expect(() => parsePluginConnectionRequest({ path: '/v1/', headers: { Authorization: 'other' } })).toThrow();
});
it('rejects embedded credentials, mutable endpoint paths, header injection and oversized JSON', () => {
  for (const origin of ['https://user:secret@api.example.com', 'https://api.example.com/', 'http://api.example.com', 'https://api.example.com?key=secret']) expect(() => parsePluginConnectionInput({ ...input, origin })).toThrow();
  for (const pathPrefix of ['/v1', '/v1/../', '/v1/?q=x']) expect(() => parsePluginConnectionInput({ ...input, pathPrefix })).toThrow();
  expect(() => parsePluginConnectionInput({ ...input, authentication: 'cookie' })).toThrow();
  expect(() => parsePluginConnectionInput({ ...input, secret: 'secret\r\nHost:evil' })).toThrow();
  expect(() => parsePluginConnectionRequest({ path: '/', method: 'POST', body: 'x'.repeat(65536) })).toThrow();
});
