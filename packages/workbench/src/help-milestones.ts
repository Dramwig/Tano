import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { splitFrontmatter } from '@tano/editor/syntax';
import { validEventDate, validEventTime } from '@tano/protocol';
import type { WorkspaceObject } from '@tano/protocol';
import type { Root, RootContent } from 'mdast';
import type { HelpChecklistId } from './help-content';

const parser = unified().use(remarkParse).use(remarkGfm);
export const markdownMilestones = ['heading', 'bold', 'italic', 'bullet-list', 'ordered-list', 'todo-list',
  'quote', 'code-block', 'inline-code', 'table', 'divider', 'external-link', 'image', 'footnote'] as const;

function featureCounts(content: string) {
  const counts = new Map<HelpChecklistId, number>();
  const add = (id: HelpChecklistId) => counts.set(id, (counts.get(id) ?? 0) + 1);
  const references = new Set<string>(), definitions = new Set<string>();
  function visit(node: Root | RootContent) {
    switch (node.type) {
      case 'heading': add('heading'); break;
      case 'strong': add('bold'); break;
      case 'emphasis': add('italic'); break;
      case 'list': add(node.ordered ? 'ordered-list' : 'bullet-list'); break;
      case 'listItem': if (typeof node.checked === 'boolean') add('todo-list'); break;
      case 'blockquote': add('quote'); break;
      case 'code': if (node.value.trim()) add('code-block'); break;
      case 'inlineCode': if (node.value.trim()) add('inline-code'); break;
      case 'table': add('table'); break;
      case 'thematicBreak': add('divider'); break;
      case 'link': if (/^https?:\/\//i.test(node.url)) add('external-link'); break;
      case 'image': if (node.url) add('image'); break;
      case 'footnoteReference': references.add(node.identifier); break;
      case 'footnoteDefinition': definitions.add(node.identifier); break;
    }
    if ('children' in node) for (const child of node.children) visit(child);
  }
  // Parse syntax, not examples inside code/HTML or frontmatter delimiters.
  visit(parser.parse(splitFrontmatter(content).body));
  counts.set('footnote', [...references].filter(id => definitions.has(id)).length);
  return counts;
}

export function newMarkdownMilestones(before: string, after: string): HelpChecklistId[] {
  const previous = featureCounts(before), current = featureCounts(after);
  return markdownMilestones.filter(id => (current.get(id) ?? 0) > (previous.get(id) ?? 0));
}

/** Receives only successfully saved user changes, not hydrated or remote records. */
export function planMilestones(before: WorkspaceObject | undefined, after: WorkspaceObject): HelpChecklistId[] {
  if (!['event', 'task'].includes(after.type)) return [];
  const result: HelpChecklistId[] = before ? [] : ['plan'];
  const previous = before?.properties ?? {}, current = after.properties;
  if ((validEventDate(current.date) && current.date !== previous.date) ||
      (validEventTime(current.start) && validEventTime(current.end) &&
       (current.start !== previous.start || current.end !== previous.end))) result.push('plan-date');
  if (after.description.trim() && after.description !== before?.description) result.push('plan-description');
  const complete = (object?: WorkspaceObject) => object?.properties.completed === true ||
    (object?.type === 'task' && ['done', 'completed'].includes(String(object.properties.status)));
  if ((after.type === 'task' || current.checkable === true) && complete(after) && !complete(before)) result.push('plan-complete');
  return result;
}
