import type { WorkspaceObject } from './objects';
import { isShortId } from './short-id';
import { validEventTime } from './object-types';

export interface TaskReview {
  version: 1;
  id: string;
  documentId: string;
  documentHash: string;
  criteriaHash: string;
  reviewerId: string;
  submitterId: string;
  state: 'pending' | 'approved' | 'changes-requested';
  submittedAt: string;
  decidedAt?: string;
  comment?: string;
}
export function parseTaskReview(value: unknown): TaskReview {
  const review = value as TaskReview;
  if (!review || typeof review !== 'object' || Array.isArray(review) || review.version !== 1 ||
      typeof review.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(review.id) ||
      !isShortId(review.documentId) || !isShortId(review.reviewerId) || !isShortId(review.submitterId) ||
      typeof review.documentHash !== 'string' || !/^[0-9a-f]{64}$/.test(review.documentHash) ||
      typeof review.criteriaHash !== 'string' || !/^[0-9a-f]{64}$/.test(review.criteriaHash) ||
      !['pending', 'approved', 'changes-requested'].includes(review.state) || !validEventTime(review.submittedAt) ||
      (review.decidedAt !== undefined && !validEventTime(review.decidedAt)) ||
      (review.comment !== undefined && (typeof review.comment !== 'string' || review.comment.length > 4000)) ||
      (review.state === 'pending' && (review.decidedAt !== undefined || review.comment !== undefined)) ||
      (review.state !== 'pending' && (!review.decidedAt || Date.parse(review.decidedAt) < Date.parse(review.submittedAt))) ||
      (review.state === 'changes-requested' && !review.comment?.trim()) ||
      Object.keys(review).some(key => !['version', 'id', 'documentId', 'documentHash', 'criteriaHash', 'reviewerId', 'submitterId', 'state', 'submittedAt', 'decidedAt', 'comment'].includes(key)))
    throw new Error('交付审阅记录无效');
  return review;
}
export function taskReview(object: Pick<WorkspaceObject, 'properties'>): TaskReview | null {
  return object.properties.deliveryReview === undefined ? null : parseTaskReview(object.properties.deliveryReview);
}
export function submitTaskReview(object: WorkspaceObject, input: Omit<TaskReview, 'version' | 'state' | 'decidedAt' | 'comment'>): WorkspaceObject {
  const review = parseTaskReview({ ...input, version: 1, state: 'pending' });
  return { ...object, properties: { ...object.properties, completed: false,
    ...(object.type === 'task' ? { status: 'todo' } : {}), deliveryReview: review } };
}
export function decideTaskReview(object: WorkspaceObject, decision: 'approved' | 'changes-requested', comment: string, now = new Date().toISOString()): WorkspaceObject {
  const previous = taskReview(object);
  if (!previous || previous.state !== 'pending') throw new Error('此交付没有待处理的审阅请求');
  const review = parseTaskReview({ ...previous, state: decision, decidedAt: now, ...(comment.trim() ? { comment: comment.trim() } : {}) });
  return { ...object, properties: { ...object.properties, completed: decision === 'approved',
    ...(object.type === 'task' ? { status: decision === 'approved' ? 'done' : 'todo' } : {}), deliveryReview: review } };
}
