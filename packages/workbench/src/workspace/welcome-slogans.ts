export const welcomeSlogans = ['好想法，值得在同页', '人与 AI，在同页工作'] as const;

export function sloganParts(slogan: string): { text: string; latin: boolean }[] {
  const spaced = slogan
    .replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, '$1 $2');
  return spaced
    .split(/([A-Za-z0-9]+)/g)
    .filter(Boolean)
    .map((text) => ({ text, latin: /^[A-Za-z0-9]+$/.test(text) }));
}
