import { describe, expect, it } from 'vitest';
import schema from '../manifest.schema.json';
import { parsePluginManifest } from './extensions';

describe('manifest.schema.json parity with parsePluginManifest', () => {
  const defs = schema.$defs;
  const execProps = defs.executableManifest.properties;

  it('matches assistant tool, context provider, service, and activationEvent patterns', () => {
    const toolRe = new RegExp(defs.assistantToolName.pattern);
    const contextRe = new RegExp(defs.assistantContextId.pattern);
    const serviceRe = new RegExp(defs.serviceName.pattern);
    const activationRe = new RegExp(defs.activationEvent.pattern);

    expect(toolRe.test('find_notes')).toBe(true);
    expect(toolRe.test('find.notes')).toBe(false);
    expect(contextRe.test('active_project')).toBe(true);
    expect(contextRe.test('active.project')).toBe(false);
    expect(serviceRe.test('search.full_text')).toBe(true);
    expect(activationRe.test('onAssistantTool:find_notes')).toBe(true);
    expect(activationRe.test('onAssistantContext:active_project')).toBe(true);
    expect(activationRe.test('onService:search.full_text')).toBe(true);

    const parsed = parsePluginManifest({
      manifestVersion: 2,
      apiVersion: 1,
      id: 'schema-parity',
      name: 'Schema Parity',
      version: '1.0.0',
      description: 'Validates underscore and dot identifiers consistently',
      objectTypes: [],
      relationTypes: [],
      permissions: ['documents.read'],
      networkOrigins: [],
      nativeCommands: [],
      commands: [{ id: 'run', label: 'Run' }],
      views: [],
      assistantTools: [
        {
          name: 'find_notes',
          label: 'Find Notes',
          description: 'Search workspace notes',
          effect: 'read',
          parameters: { type: 'object', properties: {} },
        },
      ],
      assistantContextProviders: [
        {
          id: 'active_project',
          label: 'Active Project',
          description: 'Current project context',
        },
      ],
      services: [
        {
          name: 'search.full_text',
          description: 'Full-text search service',
        },
      ],
      activationEvents: [
        'onAssistantTool:find_notes',
        'onAssistantContext:active_project',
        'onService:search.full_text',
      ],
    });

    expect(parsed.manifestVersion).toBe(2);
    if (parsed.manifestVersion === 2) {
      expect(parsed.assistantTools?.[0]?.name).toBe('find_notes');
      expect(parsed.assistantContextProviders?.[0]?.id).toBe('active_project');
      expect(parsed.services?.[0]?.name).toBe('search.full_text');
    }
  });

  it('keeps array and numeric limits aligned with runtime parser', () => {
    expect(execProps.views.maxItems).toBe(10);
    expect(execProps.automations.maxItems).toBe(10);
    expect(execProps.assistantTools.maxItems).toBe(16);
    expect(execProps.assistantContextProviders.maxItems).toBe(8);
    expect(execProps.services.maxItems).toBe(16);
    expect(execProps.usesServices.maxItems).toBe(20);
    expect(execProps.settingsSchema.maxItems).toBe(30);
    expect(execProps.activationEvents.maxItems).toBe(20);
    expect(execProps.networkOrigins.maxItems).toBe(50);
    expect(execProps.nativeCommands.maxItems).toBe(50);
    expect(defs.codeBlockRendererDefinition.properties.languages.maxItems).toBe(8);
    expect(defs.codeBlockRendererDefinition.properties.height.minimum).toBe(120);
    expect(defs.codeBlockRendererDefinition.properties.height.maximum).toBe(720);
    expect(defs.fileHandlerDefinition.properties.extensions.maxItems).toBe(16);
    expect(defs.slashCommandDefinition.properties.description.maxLength).toBe(120);
    expect(defs.slashCommandDefinition.properties.keywords.maxItems).toBe(10);
  });
});
