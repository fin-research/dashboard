import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'svelte/compiler';

const root = new URL('../src/', import.meta.url);
function walk(node, visit, parent) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(item => walk(item, visit, parent)); return; }
  visit(node, parent);
  for (const [key, child] of Object.entries(node)) if (!['attributes', 'expression', 'loc', 'metadata'].includes(key)) walk(child, visit, node.type === 'RegularElement' ? node : parent);
}
const attribute = (node, name) => node.attributes?.find(item => item.type === 'Attribute' && item.name === name);
const value = attr => Array.isArray(attr?.value) ? attr.value.filter(item => item.type === 'Text').map(item => item.data).join(' ') : '';

test('financing CSS cannot accidentally resize its shell and theme border width remains distinct from color', async () => {
  const [financing, theme, global, layout] = await Promise.all(['routes/financing/dashboard.css','app.css','styles.css','routes/+layout.svelte'].map(file => readFile(new URL(file, root), 'utf8')));
  assert.doesNotMatch(financing, /:where\(\.financing-scope\)\s*\{/);
  assert.match(global, /--border-color:\s*#[a-f0-9]+;/i);
  assert.doesNotMatch(global, /--border\s*:/);
  assert.match(theme, /--border:\s*1px/);
  assert.match(layout, /import ['"]\.\.\/app\.css['"]/);
  assert.doesNotMatch(global, /^\.card\s*\{|^\.indicator\s*\{/m);
});

test('visible native fields share daisyUI primitives and native dialogs separate overlay from scrolling content', async () => {
  let fields = 0, dialogs = 0;
  for (const file of (await readdir(root, {recursive:true})).filter(file => file.endsWith('.svelte'))) {
    const source = await readFile(new URL(file, root), 'utf8');
    walk(parse(source, {modern:true}).fragment, (node, parent) => {
      if (node.type !== 'RegularElement') return;
      const classes = value(attribute(node, 'class')).split(/\s+/);
      const type = value(attribute(node, 'type'));
      if (['input', 'select', 'textarea'].includes(node.name)) {
        if (type === 'hidden' || attribute(node,'hidden') || classes.some(c => ['sr-only','upload-file-input'].includes(c))) return;
        if (parent?.name === 'label' && value(attribute(parent,'class')).split(/\s+/).includes('input')) return;
        const primitive = node.name !== 'input' ? node.name : ({checkbox:'checkbox',radio:'radio',file:'file-input',range:'range'}[type] ?? 'input');
        assert.ok(classes.includes(primitive), `${file}:${node.start} is missing ${primitive}`);
        fields++;
      }
      if (node.name === 'dialog') {
        assert.ok(classes.includes('modal'), `${file}: native dialog needs daisyUI overlay`);
        const box = node.fragment.nodes.find(child => child.type === 'RegularElement');
        assert.ok(value(attribute(box,'class')).split(/\s+/).includes('modal-box'), `${file}: dialog content needs its own scroll container`);
        dialogs++;
      }
    });
  }
  assert.ok(fields > 90);
  assert.equal(dialogs, 9);
});

test('role drafts, failed saves, personal entry and financing multi-select retain their behavior', async () => {
  const {stdout} = await promisify(execFile)(process.execPath, ['--conditions=browser','tests/helpers/management-ui.mjs'], { cwd: new URL('../',import.meta.url), timeout:60000 });
  assert.match(stdout, /Management and account interaction checks passed/);
});
