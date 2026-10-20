import { dataEvaluator, dataViewRows, dataValueText } from '@tano/protocol';
export { canonicalFormula, displayFormula, dataEvaluator, dataViewRows, dataValueText, aggregateData } from '@tano/protocol';
export type { CellResult } from '@tano/protocol';
import { dataFieldTypes, parseDataTable, validDataValue } from '@tano/protocol';
import type {
  DataAggregate,
  DataField,
  DataRow,
  DataTable,
  DataValue,
  DataView,
} from '@tano/protocol';
export const TABLES_TAB_ID = 'tables';
export const tableTabId = (id: string) => `table:${id}`;
// A table may be opened more than once from the file context menu.  Keep the
// file id at the start of the tab id so routes and persisted table state still
// resolve to the same table, while the optional suffix gives each tab its own
// identity.
export const tableFileId = (id: string) => id.slice(6).split(':', 1)[0] ?? '';
export const isTableTab = (id: string) => id === TABLES_TAB_ID || /^table:[0-9a-f]{6}(?::[a-z0-9-]+)?$/.test(id);
export const tableItemId = () => crypto.randomUUID().replaceAll('-', '');
export const copyTable = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function newDataView(name = '全部记录'): DataView {
  return {
    id: tableItemId(),
    name,
    type: 'table',
    filters: [],
    sorts: [],
    groupBy: '',
    hiddenFields: [],
    widths: {},
    aggregates: {},
    wrap: false,
    freeze: true,
  };
}
export function newDataTable(id: string, template: 'blank' | 'parts' = 'blank'): DataTable {
  const table: DataTable = {
    version: 1,
    id,
    name: template === 'parts' ? '配件选择' : '未命名数据表',
    archived: false,
    fields: [{ id: 'name', name: '名称', type: 'text' }],
    rows: [],
    views: [newDataView()],
  };
  if (template === 'parts') {
    table.fields.push(
      {
        id: 'category',
        name: '类型',
        type: 'multiselect',
        options: ['CPU', '主板', '内存', '固态', '显卡', '散热', '电源', '机箱'],
        optionColors: {
          CPU: 'blue',
          主板: 'pink',
          内存: 'red',
          固态: 'orange',
          显卡: 'purple',
          散热: 'yellow',
          电源: 'green',
          机箱: 'brown',
        },
      },
      { id: 'spec', name: '参数', type: 'text' },
      { id: 'price', name: '价格', type: 'number' },
      {
        id: 'status',
        name: '状态',
        type: 'select',
        options: ['待比较', '选择', '拒绝'],
        optionColors: { 待比较: 'gray', 选择: 'green', 拒绝: 'red' },
      },
      {
        id: 'cost',
        name: '计入金额',
        type: 'formula',
        formula: 'IF([status] = "选择", [price], 0)',
      },
      { id: 'link', name: '商品链接', type: 'url' },
    );
    table.views[0].widths = {
      name: 220,
      category: 110,
      spec: 260,
      price: 110,
      status: 110,
      cost: 120,
      link: 180,
    };
    table.views[0].aggregates = { cost: 'sum' };
    const selected = newDataView('最终配置');
    selected.filters = [{ id: tableItemId(), field: 'status', operator: 'eq', value: '选择' }];
    selected.aggregates = { cost: 'sum' };
    table.views.push(selected);
  }
  return table;
}

export function parseCellInput(field: DataField, text: string): DataValue {
  let value: DataValue = text;
  if (!text.trim()) return null;
  if (field.type === 'number') value = Number(text.trim().replace(/,/g, ''));
  if (field.type === 'checkbox') {
    if (!['true', 'false', '1', '0', '是', '否', '✓', ''].includes(text.trim().toLowerCase()))
      throw new Error(`${field.name}：请输入是或否`);
    value = ['true', '1', '是', '✓'].includes(text.trim().toLowerCase());
  }
  if (field.type === 'multiselect' || field.type === 'attachment')
    value = text
      .split(/[、,;]/)
      .map((value) => value.trim())
      .filter(Boolean);
  if (!validDataValue(field, value))
    throw new Error(`${field.name}：无效的${dataFieldTypes[field.type]}值`);
  return value;
}
/** RFC 4180 quoting, including embedded newlines; also used for spreadsheet clipboard TSV. */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  text = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    endedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        endedQuote = true;
      } else cell += ch;
    } else if (ch === '"' && !cell && !endedQuote) quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
      endedQuote = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      endedQuote = false;
    } else {
      if (endedQuote || ch === '"') throw new Error('CSV 引号格式无效');
      cell += ch;
    }
  }
  if (quoted) throw new Error('CSV 引号没有闭合');
  if (cell || row.length || endedQuote) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
export function exportDataCsv(table: DataTable, view: DataView, all = false, query = '') {
  const evaluate = dataEvaluator(table),
    fields = table.fields.filter((field) => all || !view.hiddenFields.includes(field.id));
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return (
    '\uFEFF' +
    [
      fields.map((field) => field.name),
      ...(all ? table.rows : dataViewRows(table, view, query, evaluate)).map((row) =>
        fields.map((field) => {
          const result = evaluate(row, field.id);
          return result.error ? `#错误: ${result.error}` : dataValueText(result.value);
        }),
      ),
    ]
      .map((row) => row.map(escape).join(','))
      .join('\r\n')
  );
}
export function applyDataPaste(
  table: DataTable,
  rowIds: string[],
  fieldIds: string[],
  startRow: number,
  startField: number,
  grid: string[][],
) {
  const next = copyTable(table);
  if (grid.length > 10000 || grid.some((row) => row.length > fieldIds.length - startField))
    throw new Error('粘贴内容超出可编辑范围，请先添加足够的列（单次最多 10000 行）');
  grid.forEach((cells, ri) => {
    let row = next.rows.find((row) => row.id === rowIds[startRow + ri]);
    if (!row) {
      row = { id: tableItemId(), values: {} };
      next.rows.push(row);
    }
    cells.forEach((text, ci) => {
      const field = next.fields.find((field) => field.id === fieldIds[startField + ci])!;
      if (field.type === 'formula') return;
      if (['select', 'multiselect'].includes(field.type)) {
        const options =
          field.type === 'select' ? [text] : text.split(/[、,;]/).map((value) => value.trim());
        field.options = [...new Set([...(field.options ?? []), ...options.filter(Boolean)])];
      }
      row!.values[field.id] = parseCellInput(field, text);
    });
  });
  return parseDataTable(JSON.stringify(next));
}
