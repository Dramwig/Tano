export type MarkdownDemoLocale = 'zh-cn' | 'en-us';

export function markdownDemoPath(locale: MarkdownDemoLocale) {
  return `/${locale}/demo/`;
}

export function markdownDemoWorkspaceId(locale: MarkdownDemoLocale) {
  return `demo-${locale}`;
}

/** The workspace ID keeps the language explicit after document navigation. */
export function markdownDemoLocaleFromPath(path: string): MarkdownDemoLocale | undefined {
  const match = /^\/(zh-cn|en-us)\/demo\/?$/.exec(path)
    ?? /^\/p\/demo-(zh-cn|en-us)(?:\/[^/]+)?\/?$/.exec(path);
  return match?.[1] as MarkdownDemoLocale | undefined;
}
