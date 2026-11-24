export interface PluralMessage {
  /** Which interpolation value determines this message's grammatical number. */
  count: number | readonly number[];
  /** Multiple counts use category pairs such as one-other. */
  forms: Readonly<Record<string, string>> & { other: string };
}
export type PluralCatalog = Readonly<Record<string, PluralMessage>>;

export function pluralMessage(message: PluralMessage, values: readonly unknown[], locale: string): string {
  const indexes = typeof message.count === 'number' ? [message.count] : message.count;
  const counts = indexes.map(index => values[index]);
  if (counts.some(count => typeof count !== 'number' || !Number.isFinite(count))) return message.forms.other;
  const rules = new Intl.PluralRules(locale);
  const category = (counts as number[]).map(count => rules.select(count)).join('-');
  return message.forms[category] ?? message.forms.other;
}
