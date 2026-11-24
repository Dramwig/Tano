import { splitFrontmatter } from './syntax';

/** A bounded parser cache for suggestion revisions; never caches mutable editor state. */
export class SuggestionChangeCodec<Node> {
  private parsed = new Map<string, Node>();
  private characters = 0;
  constructor(private readonly maxEntries = 4, private readonly maxCharacters = 2 * 1024 * 1024) {}

  clear() { this.parsed.clear(); this.characters = 0; }

  private parse(markdown: string, parse: (body: string) => Node | null | undefined): Node | null | undefined {
    const body = splitFrontmatter(markdown).body;
    const cached = this.parsed.get(body);
    if (cached) {
      this.parsed.delete(body); this.parsed.set(body, cached);
      return cached;
    }
    const node = parse(body);
    if (node && body.length <= this.maxCharacters) {
      while (this.parsed.size && (this.parsed.size >= this.maxEntries || this.characters + body.length > this.maxCharacters)) {
        const key = this.parsed.keys().next().value!;
        this.parsed.delete(key); this.characters -= key.length;
      }
      this.parsed.set(body, node); this.characters += body.length;
    }
    return node;
  }

  map(options: {
    previous: string;
    current: string;
    prefix: string;
    parse: (body: string) => Node | null | undefined;
    stableSerialize: (node: Node) => string;
    serialize: (node: Node) => string;
    transform: (previous: string, before: string, after: string) => string;
  }): string | undefined {
    const baseline = this.parse(options.previous, options.parse);
    if (!baseline) throw new Error('无法解析建议基线');
    const before = options.prefix + options.stableSerialize(baseline);
    if (before === options.current) return undefined;
    const mapped = options.transform(options.previous, before, options.current);
    // Identical bytes already prove equivalence; parsing and serializing both
    // copies adds work on every ordinary suggestion edit without extra assurance.
    if (mapped === options.current) return mapped;
    const parsed = this.parse(mapped, options.parse), normalized = this.parse(options.current, options.parse);
    if (!parsed || !normalized || options.serialize(parsed) !== options.serialize(normalized))
      throw new Error('此结构修改无法精确映射，请在源码模式重新编辑；原文和已有建议保留');
    return mapped;
  }
}
