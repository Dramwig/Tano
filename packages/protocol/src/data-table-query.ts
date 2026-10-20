import type { DataAggregate, DataField, DataRow, DataTable, DataValue, DataView } from './data-tables';
type Token = { kind: 'number' | 'string' | 'field' | 'word' | 'symbol'; value: string };
type Expression =
  | { kind: 'literal'; value: DataValue }
  | { kind: 'field'; id: string }
  | { kind: 'unary'; op: string; child: Expression }
  | { kind: 'binary'; op: string; left: Expression; right: Expression }
  | { kind: 'call'; name: string; args: Expression[] };
function tokenize(source: string): Token[] {
  if (source.length > 4000) throw new Error('公式过长');
  const tokens: Token[] = [];
  let rest = source.trim().replace(/^=/, '');
  while (rest.trim()) {
    rest = rest.trimStart();
    const match =
      /^(\d+(?:\.\d*)?|\.\d+)|^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|^\[([^\]\r\n]+)\]|^([a-zA-Z_][a-zA-Z_0-9]*)|^(>=|<=|!=|==|<>|[+*/(),=<>-])/.exec(
        rest,
      );
    if (!match) throw new Error(`无法识别：${rest.slice(0, 16)}`);
    tokens.push({
      kind: match[1]
        ? 'number'
        : match[2]
          ? 'string'
          : match[3]
            ? 'field'
            : match[4]
              ? 'word'
              : 'symbol',
      value: match[3] ?? match[0],
    });
    rest = rest.slice(match[0].length);
    if (tokens.length > 600) throw new Error('公式过于复杂');
  }
  return tokens;
}
const precedence: Record<string, number> = {
  '=': 1,
  '==': 1,
  '!=': 1,
  '<>': 1,
  '>': 1,
  '<': 1,
  '>=': 1,
  '<=': 1,
  '+': 2,
  '-': 2,
  '*': 3,
  '/': 3,
};
function parseFormula(source: string, fields: DataField[]): Expression {
  const tokens = tokenize(source);
  let at = 0;
  const take = (value: string) => {
    if (tokens[at]?.value === value) {
      at++;
      return true;
    }
    return false;
  };
  const require = (value: string) => {
    if (!take(value)) throw new Error(`缺少 ${value}`);
  };
  function expression(min = 0, depth = 0): Expression {
    if (depth > 60) throw new Error('公式嵌套过深');
    const token = tokens[at++];
    if (!token) throw new Error('公式不完整');
    let left: Expression;
    if (token.kind === 'number') left = { kind: 'literal', value: Number(token.value) };
    else if (token.kind === 'string')
      left = { kind: 'literal', value: token.value.slice(1, -1).replace(/\\([\\"'])/g, '$1') };
    else if (token.kind === 'field') {
      const field =
        fields.find((field) => field.id === token.value) ??
        fields.find((field) => field.name === token.value);
      if (!field) throw new Error(`字段不存在：${token.value}`);
      left = { kind: 'field', id: field.id };
    } else if (token.value === '-' || token.value === '+')
      left = { kind: 'unary', op: token.value, child: expression(4, depth + 1) };
    else if (token.value === '(') {
      left = expression(0, depth + 1);
      require(')');
    } else if (token.kind === 'word') {
      const name = token.value.toUpperCase();
      if (['TRUE', 'FALSE'].includes(name)) left = { kind: 'literal', value: name === 'TRUE' };
      else {
        if (!['IF', 'ROUND', 'ABS', 'MIN', 'MAX', 'SUM', 'AND', 'OR', 'NOT'].includes(name))
          throw new Error(`不支持函数：${name}`);
        require('(');
        const args: Expression[] = [];
        if (!take(')')) {
          do {
            args.push(expression(0, depth + 1));
          } while (take(','));
          require(')');
        }
        if (
          !args.length ||
          (name === 'IF' && args.length !== 3) ||
          (['ABS', 'NOT'].includes(name) && args.length !== 1) ||
          (name === 'ROUND' && args.length > 2)
        )
          throw new Error(`${name} 参数数量错误`);
        left = { kind: 'call', name, args };
      }
    } else throw new Error(`意外的符号：${token.value}`);
    while (tokens[at]?.kind === 'symbol' && (precedence[tokens[at].value] ?? -1) >= min) {
      const op = tokens[at++].value;
      left = { kind: 'binary', op, left, right: expression(precedence[op] + 1, depth + 1) };
    }
    return left;
  }
  const result = expression();
  if (at !== tokens.length) throw new Error('公式存在多余内容');
  return result;
}
export function canonicalFormula(source: string, fields: DataField[]) {
  parseFormula(source, fields);
  // Token-based rewriting leaves quoted strings unchanged.
  return tokenize(source)
    .map((token) =>
      token.kind === 'field'
        ? `[${(fields.find((field) => field.id === token.value) ?? fields.find((field) => field.name === token.value))!.id}]`
        : token.value,
    )
    .join(' ');
}
export const displayFormula = (source: string, fields: DataField[]) => {
  try {
    return tokenize(source)
      .map((token) =>
        token.kind === 'field'
          ? `[${fields.find((field) => field.id === token.value)?.name ?? token.value}]`
          : token.value,
      )
      .join(' ');
  } catch {
    return source;
  }
};
export interface CellResult {
  value: DataValue;
  error?: string;
}
const number = (value: DataValue) => {
  if (value === null || value === '') return 0;
  if (typeof value !== 'number') throw new Error('需要数字字段');
  return value;
};
/** An interpreter with no eval, property access, filesystem, or network capability. */
export function dataEvaluator(table: DataTable) {
  const compiled = new Map<string, Expression | Error>();
  const cache = new Map<string, CellResult>();
  function cell(row: DataRow, fieldId: string, trail: string[] = []): CellResult {
    const key = `${row.id}/${fieldId}`;
    if (cache.has(key)) return cache.get(key)!;
    const field = table.fields.find((field) => field.id === fieldId);
    if (!field) return { value: null, error: '字段已删除' };
    if (field.type !== 'formula') return { value: row.values[fieldId] ?? null };
    try {
      if (trail.includes(fieldId) || trail.length > 60) throw new Error('公式循环引用');
      if (!compiled.has(fieldId)) {
        try {
          compiled.set(fieldId, parseFormula(field.formula ?? '', table.fields));
        } catch (error) {
          compiled.set(fieldId, error as Error);
        }
      }
      const tree = compiled.get(fieldId)!;
      if (tree instanceof Error) throw tree;
      function run(node: Expression): DataValue {
        if (node.kind === 'literal') return node.value;
        if (node.kind === 'field') {
          const result = cell(row, node.id, [...trail, fieldId]);
          if (result.error) throw new Error(result.error);
          return result.value;
        }
        if (node.kind === 'unary') return (node.op === '-' ? -1 : 1) * number(run(node.child));
        if (node.kind === 'binary') {
          const a = run(node.left),
            b = run(node.right);
          if (['=', '=='].includes(node.op)) return JSON.stringify(a) === JSON.stringify(b);
          if (['!=', '<>'].includes(node.op)) return JSON.stringify(a) !== JSON.stringify(b);
          if (node.op === '>') return number(a) > number(b);
          if (node.op === '<') return number(a) < number(b);
          if (node.op === '>=') return number(a) >= number(b);
          if (node.op === '<=') return number(a) <= number(b);
          if (node.op === '+') return number(a) + number(b);
          if (node.op === '-') return number(a) - number(b);
          if (node.op === '*') return number(a) * number(b);
          if (number(b) === 0) throw new Error('除数为零');
          return number(a) / number(b);
        }
        if (node.name === 'IF') return run(node.args[0]) ? run(node.args[1]) : run(node.args[2]);
        if (node.name === 'AND') return node.args.every((arg) => !!run(arg));
        if (node.name === 'OR') return node.args.some((arg) => !!run(arg));
        if (node.name === 'NOT') return !run(node.args[0]);
        const args = node.args.map((arg) => number(run(arg)));
        if (node.name === 'ABS') return Math.abs(args[0]);
        if (node.name === 'ROUND') {
          const digits = args[1] ?? 0;
          if (!Number.isInteger(digits) || Math.abs(digits) > 12)
            throw new Error('小数位须为 -12 到 12 的整数');
          return Math.round(args[0] * 10 ** digits) / 10 ** digits;
        }
        if (node.name === 'MIN') return Math.min(...args);
        if (node.name === 'MAX') return Math.max(...args);
        return args.reduce((sum, n) => sum + n, 0);
      }
      const value = run(tree);
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('计算结果超出范围');
      const result = { value };
      cache.set(key, result);
      return result;
    } catch (error) {
      const result = { value: null, error: (error as Error).message };
      cache.set(key, result);
      return result;
    }
  }
  return cell;
}
export const dataValueText = (value: DataValue) =>
  value === null
    ? ''
    : Array.isArray(value)
      ? value.join('、')
      : typeof value === 'boolean'
        ? value
          ? '是'
          : '否'
        : String(value);
export function dataViewRows(
  table: DataTable,
  view: DataView,
  query = '',
  evaluate = dataEvaluator(table),
) {
  const empty = (value: DataValue) =>
    value === null || value === '' || (Array.isArray(value) && !value.length);
  return table.rows
    .filter((row) => {
      if (
        query &&
        !table.fields.some((field) =>
          dataValueText(evaluate(row, field.id).value)
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        )
      )
        return false;
      return view.filters.every((filter) => {
        const result = evaluate(row, filter.field),
          value = result.value;
        if (result.error) return false;
        if (filter.operator === 'empty') return empty(value);
        if (filter.operator === 'notEmpty') return !empty(value);
        if (filter.operator === 'contains')
          return dataValueText(value)
            .toLocaleLowerCase()
            .includes(filter.value.toLocaleLowerCase());
        if (filter.operator === 'gt' || filter.operator === 'lt') {
          if (empty(value)) return false;
          const field = table.fields.find((field) => field.id === filter.field)!;
          if (field.type === 'date')
            return filter.operator === 'gt'
              ? String(value) > filter.value
              : String(value) < filter.value;
          return (
            typeof value === 'number' &&
            filter.value.trim() !== '' &&
            Number.isFinite(Number(filter.value)) &&
            (filter.operator === 'gt' ? value > Number(filter.value) : value < Number(filter.value))
          );
        }
        const equal = Array.isArray(value)
          ? value.includes(filter.value)
          : typeof value === 'boolean'
            ? String(value) === filter.value || dataValueText(value) === filter.value
            : typeof value === 'number'
              ? filter.value.trim() !== '' && Number(filter.value) === value
              : dataValueText(value) === filter.value;
        return filter.operator === 'ne' ? !equal : equal;
      });
    })
    .sort((a, b) => {
      for (const sort of view.sorts) {
        const av = evaluate(a, sort.field).value,
          bv = evaluate(b, sort.field).value;
        if (empty(av) !== empty(bv)) return empty(av) ? 1 : -1;
        const delta =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : dataValueText(av).localeCompare(dataValueText(bv), 'zh-CN', { numeric: true });
        if (delta) return delta * (sort.direction === 'desc' ? -1 : 1);
      }
      return 0;
    });
}
export function aggregateData(
  rows: DataRow[],
  fieldId: string,
  mode: DataAggregate,
  evaluate: ReturnType<typeof dataEvaluator>,
) {
  if (mode === 'none') return '';
  if (mode === 'count') return String(rows.length);
  const results = rows.map((row) => evaluate(row, fieldId));
  if (results.some((result) => result.error)) return '含公式错误';
  const values = results.map((result) => result.value);
  if (mode === 'filled')
    return String(
      values.filter(
        (value) => value !== null && value !== '' && (!Array.isArray(value) || value.length),
      ).length,
    );
  const numbers = values.filter((value): value is number => typeof value === 'number');
  if (!numbers.length) return mode === 'sum' ? '0' : '—';
  const sum = numbers.reduce((a, b) => a + b, 0);
  const result =
    mode === 'sum'
      ? sum
      : mode === 'average'
        ? sum / numbers.length
        : mode === 'min'
          ? Math.min(...numbers)
          : Math.max(...numbers);
  return Number.isFinite(result) ? String(Number(result.toFixed(8))) : '结果超出范围';
}
