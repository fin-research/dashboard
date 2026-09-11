import assert from 'node:assert/strict';
import { installDom, loadComponent } from './svelte-dom.mjs';
import { FOCUS_STORAGE_PREFIX } from '../../src/focus-editor.ts';
const window = installDom();
const { mount, unmount, flushSync } = await import('svelte');
window.localStorage.setItem(`${FOCUS_STORAGE_PREFIX}2026-09-11`, '原始草稿');
const Host = await loadComponent('tests/helpers/FocusHost.svelte', `<script>
import FocusEditor from '../../src/components/FocusEditor.svelte';
let generating = $state(false), summaries = $state([]), result = $state(null), text = $state('');
export function progress() { generating = true; summaries = [{id:'0', text:'**<b>摘要</b>**'}]; }
export function nextProgress() { summaries = [...summaries, {id:'1', text:'**债市分析**'}]; }
export function reset() { summaries = []; }
export function cancel() { generating = false; }
export function complete() { generating = false; result = {report_date:'2026-09-11', stock:'股市结论', bond:'债市结论', news_count:2}; }
export function value() { return text; }
</script>
<FocusEditor reportDate="2026-09-11" {generating} {summaries} generatedBriefing={result} onTextChange={(value) => text = value} />`);
const app = mount(Host, { target: document.body }); flushSync();
assert.equal(app.value(), '原始草稿');
flushSync(() => app.progress());
assert.equal(app.value(), '');
assert.equal(document.querySelector('.focus-progress-message').textContent, '<b>摘要</b>');
assert.equal(document.querySelector('.focus-progress-message b'), null);
assert.equal(document.querySelector('[contenteditable]').hidden, false);
assert.equal(document.querySelector('[contenteditable]').textContent, '');
assert.equal(document.querySelector('[contenteditable]').dataset.placeholder, '');
assert.equal(document.querySelector('.focus-progress.focus-editor'), null);
assert.equal(document.querySelector('.focus-progress .loading-spinner'), null);
assert.equal(document.querySelector('.focus-progress-message').title, '<b>摘要</b>');
flushSync(() => app.nextProgress());
await new Promise(resolve => setTimeout(resolve, 350));
assert.equal(document.querySelectorAll('.focus-progress-message').length, 1);
assert.equal(document.querySelector('.focus-progress-message').textContent, '债市分析');
flushSync(() => app.reset());
await new Promise(resolve => setTimeout(resolve, 350));
assert.equal(document.querySelector('.focus-progress-message').textContent, '正在分析股债市场');
assert.equal(window.localStorage.getItem(`${FOCUS_STORAGE_PREFIX}2026-09-11`), null);
flushSync(() => app.cancel());
assert.equal(document.querySelector('[contenteditable]').hidden, false);
assert.equal(app.value(), '');
flushSync(() => app.complete());
assert.equal(app.value(), '1、股市结论\n2、债市结论');
assert.equal(document.querySelector('.focus-progress'), null);
assert.doesNotMatch(window.localStorage.getItem(`${FOCUS_STORAGE_PREFIX}2026-09-11`), /摘要/);
await unmount(app);
