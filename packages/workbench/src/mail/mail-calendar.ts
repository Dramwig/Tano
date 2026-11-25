// SPDX-License-Identifier: MIT
import type { WorkspaceObject } from '@tano/protocol';
import type { ObjectRecord } from '../objects/workspace-objects';
import { parseCalendar } from '../plan-sync/ical';
import { itemProperties } from '../plan-sync/types';
import { hasEventTime } from '../plans/calendar';
import {
  formatMailAddressList,
  type MailCalendarInvite,
  type MailMessageDetail,
  type RsvpResponseStatus,
} from './types';

export interface ParsedInvitePreview {
  summary: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  description: string;
  organizerEmail: string | null;
  conflicts: ObjectRecord[];
}

export function extractOrganizerEmail(rawIcs: string): string | null {
  const unfolded = rawIcs.replace(/\r?\n[ \t]/g, '');
  const match = unfolded.match(/^ORGANIZER[^:\r\n]*:(?:mailto:)?([^\r\n\s;]+)/im);
  return match?.[1]?.trim() || null;
}

export function parseInvitePreview(
  invite: MailCalendarInvite,
  existingRecords: readonly ObjectRecord[],
): ParsedInvitePreview {
  const organizerEmail = extractOrganizerEmail(invite.rawIcs);
  try {
    const parsed = parseCalendar(invite.rawIcs, 'calendar');
    const first = parsed.items[0]?.value;
    if (first) {
      const conflicts = findOverlappingEvents(existingRecords, first.start, first.end);
      return {
        summary: first.name || invite.summary,
        start: first.start,
        end: first.end,
        allDay: first.allDay,
        description: first.description,
        organizerEmail,
        conflicts,
      };
    }
  } catch {
    // Fall back to lightweight header metadata when the ICS lacks optional VTIMEZONE definitions.
  }
  return {
    summary: invite.summary || '日历邀请',
    description: '',
    organizerEmail,
    conflicts: [],
  };
}

export function findOverlappingEvents(
  records: readonly ObjectRecord[],
  startIso?: string,
  endIso?: string,
): ObjectRecord[] {
  if (!startIso || !endIso) return [];
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  return records.filter((record) => {
    if (record.object.archived || !hasEventTime(record)) return false;
    const from = Date.parse(String(record.object.properties.start));
    const to = Date.parse(String(record.object.properties.end));
    return from < end && to > start;
  });
}

export function buildEventDraftFromInvite(
  invite: MailCalendarInvite,
  detail: MailMessageDetail,
  existingRecords: readonly ObjectRecord[],
): Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'archived' | 'properties'> {
  const preview = parseInvitePreview(invite, existingRecords);
  const sourceNote = [
    `来源邮件：${detail.summary.subject}`,
    `发件人：${formatMailAddressList(detail.summary.from)}`,
    detail.summary.messageId ? `Message-ID: ${detail.summary.messageId}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const description = [preview.description.trim(), sourceNote].filter(Boolean).join('\n\n').slice(0, 18_000);
  const properties = itemProperties(
    {
      name: preview.summary,
      description,
      start: preview.start,
      end: preview.end,
      allDay: preview.allDay,
      archived: false,
    },
    'calendar',
  );
  return {
    type: 'event',
    name: preview.summary.slice(0, 200),
    description,
    archived: false,
    properties,
  };
}

export function buildPlanDraftFromEmail(
  detail: MailMessageDetail,
  mode: 'calendar' | 'todo',
  now = new Date(),
): Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'archived' | 'properties'> {
  const name = (detail.summary.subject || '来自邮件的事项').slice(0, 200);
  const excerpt = (detail.textBody || detail.summary.snippet || '').trim().slice(0, 3000);
  const description = [
    `发件人：${formatMailAddressList(detail.summary.from)}`,
    detail.summary.messageId ? `Message-ID: ${detail.summary.messageId}` : '',
    excerpt,
  ]
    .filter(Boolean)
    .join('\n\n');

  if (mode === 'todo') {
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return {
      type: 'event',
      name,
      description,
      archived: false,
      properties: {
        due: today,
        checkable: true,
        completed: false,
      },
    };
  }

  const start = new Date(now.getTime());
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    type: 'event',
    name,
    description,
    archived: false,
    properties: {
      start: start.toISOString(),
      end: end.toISOString(),
      checkable: false,
      completed: false,
    },
  };
}

/**
 * Generates an RFC 5546 iTIP `METHOD:REPLY` VCALENDAR payload so the desktop client
 * can send a real calendar RSVP through the user's own SMTP server.
 */
export function buildRsvpReplyIcs(
  rawIcs: string,
  attendeeEmail: string,
  attendeeName: string,
  status: RsvpResponseStatus,
  now = new Date(),
): string {
  const unfolded = rawIcs.replace(/\r?\n[ \t]/g, '');
  const pick = (prop: string) => {
    const m = unfolded.match(new RegExp(`^(${prop}(?:;[^:\\r\\n]*)?:[^\\r\\n]+)$`, 'im'));
    return m?.[1]?.trim() ?? '';
  };
  const uidLine = pick('UID') || `UID:tano-${crypto.randomUUID()}`;
  const dtstartLine = pick('DTSTART');
  const dtendLine = pick('DTEND');
  const summaryLine = pick('SUMMARY') || 'SUMMARY:Meeting';
  const organizerLine = pick('ORGANIZER');
  const sequenceLine = pick('SEQUENCE');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const safeCn = attendeeName.replace(/["\r\n;,:]/g, ' ').trim();
  const attendeeLine = safeCn
    ? `ATTENDEE;CN="${safeCn}";PARTSTAT=${status}:mailto:${attendeeEmail}`
    : `ATTENDEE;PARTSTAT=${status}:mailto:${attendeeEmail}`;

  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//Tano//Desktop Mail//EN',
    'VERSION:2.0',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    uidLine,
    `DTSTAMP:${stamp}`,
    dtstartLine,
    dtendLine,
    summaryLine,
    organizerLine,
    sequenceLine,
    attendeeLine,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .filter((line, index, all) => line.length > 0 || index === all.length - 1)
    .join('\r\n');
}
