import type { Component } from 'vue';
import {
  AtSign, CodeXml, Columns2, Heading, Heading1, Heading2, Heading3, Heading4,
  Image, Info, Lightbulb, List, ListCollapse, ListOrdered, ListTodo, Minus,
  PanelsTopLeft, Paperclip, Pilcrow, Quote, Sigma, SquareCode, Table2, Workflow,
} from 'lucide-vue-next';
import type { blockTypes } from './selection-context';

/** Shared by the toolbar and slash menu so block identities stay visually consistent. */
export const blockIcons = {
  ObjectReference: AtSign,
  Heading,
  Paragraph: Pilcrow,
  Quote,
  BulletList: List,
  OrderedList: ListOrdered,
  TodoList: ListTodo,
  CodeBlock: CodeXml,
  ImageBlock: Image,
  Table: Table2,
  MermaidBlock: Workflow,
  Callout: Info,
  Toggle: ListCollapse,
  FileBlock: Paperclip,
  Embed: SquareCode,
  Tabs: PanelsTopLeft,
  Columns: Columns2,
  HorizontalRule: Minus,
  MathBlock: Sigma,
} satisfies Record<(typeof blockTypes)[number]['type'], Component>;

export const headingIcons = [Heading1, Heading2, Heading3, Heading4];
export const customCalloutIcon = Lightbulb;
export const blockIconStrokeWidth = 1.75;
