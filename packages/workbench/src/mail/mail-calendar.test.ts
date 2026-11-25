// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { ObjectRecord } from '../objects/workspace-objects';
import {
  buildEventDraftFromInvite,
  buildPlanDraftFromEmail,
  buildRsvpReplyIcs,
  extractOrganizerEmail,
  parseInvitePreview,
} from './mail-calendar';
import type { MailCalendarInvite, MailMessageDetail } from './types';

const sampleIcs = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:meeting-42@example.com',
  'ORGANIZER;CN="Alice":mailto:alice@example.com',
  'SUMMARY:Tano 架构评审',
  'DESCRIPTION:讨论本地邮件与日历联动',
  'DTSTART:20261126T060000Z',
  'DTEND:20261126T070000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const sampleInvite: MailCalendarInvite = {
  id: 'msg-1:ics:0',
  messageId: 'msg-1',
  icsUid: 'meeting-42@example.com',
  method: 'REQUEST',
  summary: 'Tano 架构评审',
  rawIcs: sampleIcs,
  importedObjectId: null,
  rsvpStatus: null,
};

const sampleDetail: MailMessageDetail = {
  summary: {
    id: 'msg-1',
    accountId: 'acc-1',
    folderId: 'f-1',
    uid: 10,
    messageId: 'msg-10@example.com',
    threadKey: 'msg-10@example.com',
    subject: '邀请：Tano 架构评审',
    from: [{ name: 'Alice', address: 'alice@example.com' }],
    to: [{ name: 'Bob', address: 'bob@qq.com' }],
    dateTs: 1_764_000_000,
    snippet: '讨论本地邮件与日历联动',
    seen: true,
    flagged: false,
    answered: false,
    hasAttachments: false,
    hasIcs: true,
    bodyFetched: true,
  },
  cc: [],
  replyTo: [],
  inReplyTo: null,
  references: [],
  textBody: '讨论本地邮件与日历联动',
  htmlSanitized: '',
  hasRemoteImages: false,
  attachments: [],
  invites: [sampleInvite],
};

describe('mail-calendar integration', () => {
  it('parses ICS invite and detects conflicting local calendar events', () => {
    const conflictingRecord = {
      path: '.tano/objects/ev-1.tano.json',
      snapshot: { path: '.tano/objects/ev-1.tano.json', content: '', hash: 'h1', modifiedAt: 0 },
      object: {
        id: 'ev-1',
        version: 1,
        type: 'event',
        name: '已有评审',
        description: '',
        archived: false,
        properties: {
          start: '2026-11-26T06:30:00.000Z',
          end: '2026-11-26T07:30:00.000Z',
        },
      },
    } as unknown as ObjectRecord;

    const preview = parseInvitePreview(sampleInvite, [conflictingRecord]);
    expect(preview.summary).toBe('Tano 架构评审');
    expect(preview.organizerEmail).toBe('alice@example.com');
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0]!.object.id).toBe('ev-1');
  });

  it('builds calendar event and todo drafts without altering object schema', () => {
    const fromInvite = buildEventDraftFromInvite(sampleInvite, sampleDetail, []);
    expect(fromInvite.type).toBe('event');
    expect(fromInvite.name).toBe('Tano 架构评审');
    expect(fromInvite.description).toContain('msg-10@example.com');
    expect(fromInvite.properties.start).toBe('2026-11-26T06:00:00.000Z');

    const todo = buildPlanDraftFromEmail(sampleDetail, 'todo', new Date('2026-11-25T10:00:00Z'));
    expect(todo.type).toBe('event');
    expect(todo.properties.checkable).toBe(true);
    expect(todo.properties.completed).toBe(false);
    expect(todo.properties.due).toBe('2026-11-25');
  });

  it('builds a valid RFC 5546 METHOD:REPLY ICS payload for SMTP RSVP', () => {
    expect(extractOrganizerEmail(sampleIcs)).toBe('alice@example.com');
    const reply = buildRsvpReplyIcs(
      sampleIcs,
      'bob@qq.com',
      'Bob',
      'ACCEPTED',
      new Date('2026-11-25T12:00:00Z'),
    );
    expect(reply).toContain('METHOD:REPLY');
    expect(reply).toContain('UID:meeting-42@example.com');
    expect(reply).toContain('PARTSTAT=ACCEPTED:mailto:bob@qq.com');
    expect(reply).toContain('ORGANIZER;CN="Alice":mailto:alice@example.com');
  });
});
