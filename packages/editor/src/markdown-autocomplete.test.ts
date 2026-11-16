import { expect, it } from 'vitest';
import { continueMarkup, closeMarkupFence, closingBracket, normalizeMarkdownAutocomplete } from './markdown-autocomplete';
it.each([['- a','- '],['* a','* '],['+ a','+ '],['9. a','10. '],['3) a','4) '],['- [X] a','- [ ] '],['> a','> '],['> - a','> - '],['  - a','  - ']])('continues %s', (line, prefix) => {
 expect(continueMarkup(line, line.length)?.insert).toBe('\n' + prefix);
});
it('exits empty items and outdents nested items', () => {
 expect(continueMarkup('- ',2)?.insert).toBe('');
 expect(continueMarkup('> - ',4)?.insert).toBe('> ');
 expect(continueMarkup('> ',2)?.insert).toBe('');
 expect(continueMarkup('  - ',4,{previousLines:['- parent']})?.insert).toBe('- ');
 expect(continueMarkup('- ',2,{backspace:true})?.insert).toBe('');
 expect(continueMarkup('- a',3,{backspace:true})).toBeNull();
 expect(continueMarkup('- a',1)).toBeNull();
 expect(continueMarkup('- a',3,{blocked:true})).toBeNull();
 expect(continueMarkup('- a  bc',3)).toMatchObject({to:5,insert:'\n- '});
});
it.each(['```','```ts','~~~','$$'])('closes unmatched fence %s', line => {
 expect(closeMarkupFence(line,0,true)?.cursor).toBe(1);
 expect(closeMarkupFence(line+'\nbody\n'+(line==='```ts'?'```':line),0,true)).toBeNull();
});
it('ignores frontmatter, balanced fences and disabled math',()=>{
 expect(closeMarkupFence('---\n```\n---',4,true)).toBeNull();
 expect(closeMarkupFence('```\n```\n```\n```',0,true)).toBeNull();
 expect(closeMarkupFence('$$',0,false)).toBeNull();
});
it('pairs only safe punctuation',()=>{
 expect(closingBracket('x',' ','(')).toBe(')');
 expect(closingBracket('x',']','[')).toBe(']');
 expect(closingBracket('x','','`')).toBe('`');
 expect(closingBracket('','','`')).toBeNull();
 expect(closingBracket('x`','','`')).toBeNull();
 expect(closingBracket('x','a','(')).toBeNull();
 expect(normalizeMarkdownAutocomplete({listContinuation:false, bracketPairs:'yes'})).toEqual({listContinuation:false,fenceClosing:true,bracketPairs:false});
});
