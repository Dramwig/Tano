import { describe, expect, it } from 'vitest';
import { parseAssistantSession, type AssistantSession } from './assistant';

function sessionWithProposal(proposal: Record<string, unknown>): AssistantSession {
  return {
    version: 1,
    id: '12345678-1234-1234-1234-1234567890ab',
    workspaceId: 'ws-1',
    title: 'Test',
    createdAt: 1,
    updatedAt: 2,
    revision: 1,
    messages: [
      {
        id: 'msg-1',
        role: 'assistant',
        content: 'done',
        createdAt: 2,
        proposals: [proposal as never],
      },
    ],
  };
}

describe('parseAssistantSession extension proposals', () => {
  it('accepts valid first-class kind="extension" proposals with structured payload and undoSnapshot', () => {
    const parsed = parseAssistantSession(
      sessionWithProposal({
        id: 'prop-1',
        runId: 'msg-1',
        workspaceId: 'ws-1',
        kind: 'extension',
        path: 'Host Extension Action',
        base: '',
        content: '{"scope":"user","patch":{}}',
        reason: 'Adjust workbench layout',
        status: 'applied',
        extensionAction: {
          namespace: 'host.overlay',
          action: 'apply_overlay',
          label: 'Apply Overlay',
          effect: 'write',
          payload: { scope: 'user', patch: { typography: { fontSize: 16 } } },
        },
        applied: {
          before: '',
          after: '{}',
          hash: 'apply_overlay',
          fileId: 'host.overlay',
          undoSnapshot: '{"scope":"user","previous":null}',
        },
      }),
    );
    const prop = parsed.messages[0]!.proposals![0]!;
    expect(prop.kind).toBe('extension');
    expect(prop.extensionAction?.namespace).toBe('host.overlay');
    expect(prop.applied?.undoSnapshot).toContain('"scope":"user"');
  });

  it('rejects kind="extension" proposals missing extensionAction or containing non-object payload', () => {
    expect(() =>
      parseAssistantSession(
        sessionWithProposal({
          id: 'prop-bad-1',
          runId: 'msg-1',
          workspaceId: 'ws-1',
          kind: 'extension',
          path: 'Missing metadata',
          base: '',
          content: '{}',
          reason: 'Bad',
          status: 'ready',
        }),
      ),
    ).toThrow();

    expect(() =>
      parseAssistantSession(
        sessionWithProposal({
          id: 'prop-bad-2',
          runId: 'msg-1',
          workspaceId: 'ws-1',
          kind: 'extension',
          path: 'Bad payload',
          base: '',
          content: '{}',
          reason: 'Bad',
          status: 'ready',
          extensionAction: {
            namespace: 'host.overlay',
            action: 'apply',
            effect: 'write',
            payload: ['not', 'an', 'object'],
          },
        }),
      ),
    ).toThrow();
  });
});
