/** Shared by edit/proposal tool descriptions and system prompts. Keep aligned with proposalFromTool. */
export const editDocumentRules = [
  'sourceId 必须指向已读取的当前快照。非空 oldText 必须是完整来源中唯一的原始片段。',
  '空 oldText 仅允许两种情况，且 newText 必须非空：完整来源为空且没有 selection 时初始化；非空来源带有明确的零长度选区（selection.from === selection.to）时在该位置插入。其他情况不得使用空 oldText。',
  '修改必须在 selection.from/to 的源码边界内；选区没有可用源码位置时不得猜测位置或扩大范围。保留未涉及内容、YAML、引用、代码和附件。',
  '.table.json 修改后必须是合法的表结构 JSON，保留表身份、已有行/字段/视图 ID 和未涉及字段；不要包裹 Markdown 代码围栏。',
].join('\n');
