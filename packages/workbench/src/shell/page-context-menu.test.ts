// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { isBlankPageTarget } from './page-context-menu';

it('opens the page menu only on editor whitespace', () => {
  const page = document.createElement('div');
  page.className = 'editor-scroll';
  page.innerHTML = `
    <div class="document-title"><input /></div>
    <div class="milkdown-host"><div class="tano-prose"><h2><span>Title</span></h2></div></div>
    <div class="source-editor"><div class="cm-editor"><div class="cm-line">Source</div></div></div>
  `;
  expect(isBlankPageTarget(page)).toBe(true);
  expect(isBlankPageTarget(page.querySelector('.milkdown-host'))).toBe(true);
  expect(isBlankPageTarget(page.querySelector('.tano-prose'))).toBe(true);
  expect(isBlankPageTarget(page.querySelector('h2 span'))).toBe(false);
  expect(isBlankPageTarget(page.querySelector('.document-title input'))).toBe(false);
  expect(isBlankPageTarget(page.querySelector('.cm-line'))).toBe(false);
});
