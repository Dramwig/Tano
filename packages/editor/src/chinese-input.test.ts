import { expect, it } from 'vitest';
import { chineseInputOptions, defaultChineseInput, mapChineseInput, normalizeChineseInput, mappedChineseInputKey, mappedChineseBeforeInput } from './chinese-input';

it('keeps every mapping disabled by default and enables only the chosen keys', () => {
  const input = '【】（）；，。！……￥';
  expect(Object.values(defaultChineseInput).every(enabled => !enabled)).toBe(true);
  expect(mapChineseInput(input)).toBe(input);
  expect(mapChineseInput(input, { comma: true, ellipsisToCaret: true })).toBe('【】（）；,。！^￥');
  const enabled = Object.fromEntries(chineseInputOptions.map(({ key }) => [key, true]));
  expect(mapChineseInput(input, enabled)).toBe('[]();,.!^$');
  expect(mapChineseInput('中文 ABC 123 ¥ …', enabled)).toBe('中文 ABC 123 ¥ …');
});

const keyEvent = {
  key: '【', code: 'BracketLeft', keyCode: 219, shiftKey: false,
  ctrlKey: false, metaKey: false, altKey: false, isComposing: false, cancelable: true, defaultPrevented: false,
};
const enabled = Object.fromEntries(chineseInputOptions.map(({ key }) => [key, true]));

it.each([
  ['【', '['], ['】', ']'], ['；', ';'], ['，', ','], ['。', '.'],
  ['（', '('], ['）', ')'], ['！', '!'], ['……', '^'], ['￥', '$'],
])('maps an explicit punctuation key %s before insertion', (key, output) => {
  const event = { ...keyEvent, key };
  expect(mappedChineseInputKey(event, enabled)).toBe(output);
  expect(mappedChineseInputKey(event)).toBeNull();
});

it('leaves IME keys to their actual input/commit even when the physical key is known', () => {
  for (const code of ['BracketLeft', 'BracketRight', 'Semicolon', 'Comma', 'Period', 'Digit9', 'Digit6', 'Digit4'])
    for (const shiftKey of [false, true])
      for (const changed of [{ key: 'Process' }, { key: 'Unidentified' }, { keyCode: 229 }])
        expect(mappedChineseInputKey({ ...keyEvent, code, shiftKey, ...changed }, enabled)).toBeNull();
});

it('preserves compositions, shortcuts, dead keys and other keyboard layouts', () => {
  expect(mappedChineseInputKey({ ...keyEvent, key: '【', keyCode: 219 }, enabled)).toBe('[');
  expect(mappedChineseInputKey({ ...keyEvent, key: 'Unidentified', keyCode: 0 }, enabled)).toBeNull();
  for (const changed of [
    { isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
    { cancelable: false }, { defaultPrevented: true }, { key: 'Dead' },
    { key: 'ü', keyCode: 219 }, { key: '[', keyCode: 219 }, { key: 'a', code: 'KeyA' },
  ]) expect(mappedChineseInputKey({ ...keyEvent, ...changed }, enabled)).toBeNull();
});

it('maps cancelable text beforeinput without intercepting composition updates or paste', () => {
  const event = { inputType: 'insertText', data: '【', isComposing: false, cancelable: true, defaultPrevented: false };
  expect(mappedChineseBeforeInput(event, enabled)).toBe('[');
  expect(mappedChineseBeforeInput(event)).toBeNull();
  for (const changed of [
    { isComposing: true }, { cancelable: false }, { defaultPrevented: true }, { data: null },
    { inputType: 'insertFromPaste' }, { inputType: 'insertCompositionText' }, { data: '[' },
  ]) expect(mappedChineseBeforeInput({ ...event, ...changed }, enabled)).toBeNull();
});

it('normalizes stored preferences and migrates yuan without overriding an explicit off switch', () => {
  expect(normalizeChineseInput(null)).toEqual(defaultChineseInput);
  expect(normalizeChineseInput({ brackets: 'true', comma: true })).toEqual({ ...defaultChineseInput, comma: true });
  expect(normalizeChineseInput(undefined, { yenToDollar: true })).toEqual({ ...defaultChineseInput, yenToDollar: true });
  expect(normalizeChineseInput({ yenToDollar: false }, { yenToDollar: true })).toEqual(defaultChineseInput);
});
