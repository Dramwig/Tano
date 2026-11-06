import { referenceSyntax, type ReferenceTarget } from '@tano/protocol';
import { t } from './i18n';
import landscape from './assets/preview-landscape.svg';

export function previewTargets(): ReferenceTarget[] {
  return [{ type: 'document', id: 'a00001', workspace: 'preview', name: t('海边两日游'),
    path: `${t('海边两日游')}.md`, description: t('路线、住宿与沿途风景') }];
}
export const previewImage = 'preview/coast.svg';
export function previewResource(reference: string) { return reference === previewImage ? landscape : null; }
export function previewHeading(level = 1) {
  return [t('周末去看海'), t('沿着海岸慢慢走'), t('在灯塔下等日落'), t('带上相机和好心情')][level - 1] ?? t('海边两日游');
}
export function blockPreviewMarkdown(command: string, value?: string): string {
  const paragraph = t('海风吹过，远处的灯塔亮了起来。');
  const panel = (title: string, body: string) => `:::panel ${JSON.stringify(title)}\n\n${body}\n\n:::`;
  switch (command) {
    case 'heading': { const level = Math.max(1, Math.min(4, Number(value) || 1)); return `${'#'.repeat(level)} ${previewHeading(level)}\n\n${paragraph}`; }
    case 'paragraph': return t('周末搭上清晨的列车，去海边走走。带一本书，在咖啡馆里等日落。');
    case 'quote': return `> ${t('走慢一点，沿途的风景也值得停留。')}`;
    case 'list': return `- ${t('相机和备用电池')}\n- ${t('一本读到一半的书')}`;
    case 'ordered-list': return `1. ${t('乘早班列车出发')}\n2. ${t('沿着海岸步行到灯塔')}`;
    case 'todo-list': return `- [ ] ${t('预订周六的车票')}\n- [x] ${t('查好周末的天气')}`;
    case 'code-block': return "```javascript\nconst days = 2;\nconst cost = 180;\ndays * cost; // 360\n```";
    case 'image': return `![${t('海边两日游')}](${previewImage})`;
    case 'table': return `| ${t('开销')} | ${t('金额')} |\n| --- | --- |\n| ${t('早餐')} | ¥18 |\n| ${t('咖啡')} | ¥24 |`;
    case 'mermaid': return `\`\`\`mermaid\nflowchart LR\n  A[${t('写作')}] --> B[${t('分享')}]\n\`\`\``;
    case 'callout': return value === 'CUSTOM'
      ? `> [!CUSTOM:💡]\n> **${t('灵感')}**\n>\n> ${t('把沿途的声音也收进旅行记录。')}`
      : `> [!NOTE]\n> ${t('记得下载离线地图，海边的信号不太稳定。')}`;
    case 'toggle': return `<details>\n<summary>${t('出行清单')}</summary>\n\n${t('背包里放好相机、水和雨伞。')}\n\n</details>`;
    case 'file': return `:::file\n\n[${t('旅行行程.pdf')}](preview/itinerary.pdf)\n\n:::`;
    // The actual embed view previews images/audio/video; PDFs render as file cards.
    case 'embed': return `:::embed\n\n[${t('海边两日游')}](${previewImage})\n\n:::`;
    case 'object-reference': return referenceSyntax(previewTargets()[0]!, true);
    case 'tabs': return `::::tabs\n\n${panel(t('行程'), t('09:00 出发，16:30 到海边看日落。'))}\n\n${panel(t('预算'), `${t('早餐')} ¥18`)}\n\n::::`;
    case 'columns': return `::::columns\n\n${panel(t('上午'), t('沿着海岸散步。'))}\n\n${panel(t('傍晚'), t('在灯塔下等日落。'))}\n\n::::`;
    case 'horizontal-rule': return `${t('旅途告一段落。')}\n\n---\n\n${t('下一站，继续出发。')}`;
    case 'math-block': return '$$\nE = mc^2\n$$';
    default: return paragraph;
  }
}
export function capabilityPreviewMarkdown(feature: string): string {
  switch (feature) {
    case 'objectReferences': return blockPreviewMarkdown('object-reference');
    case 'math': return blockPreviewMarkdown('math-block');
    case 'mermaid': return blockPreviewMarkdown('mermaid');
    case 'wikiLink': return `[[${t('海边两日游')}]]`;
    case 'callout': return blockPreviewMarkdown('callout');
    case 'footnotes': return `${t('沿着海岸步行到灯塔。')}[^route]\n\n[^route]: ${t('路线、住宿与沿途风景')}`;
    case 'embed': return blockPreviewMarkdown('embed');
    case 'html': return `<strong>${t('海边两日游')}</strong>`;
    case 'enhanced': return blockPreviewMarkdown('toggle');
    case 'superscript': return 'x^2^';
    case 'subscript': return 'H~2~O';
    case 'underline': return `++${t('海边两日游')}++`;
    case 'highlight': return `==${t('海边两日游')}==`;
    case 'inlineComment': return `${t('沿着海岸散步。')} %%${t('记得带相机。')}%%`;
    default: return '';
  }
}
