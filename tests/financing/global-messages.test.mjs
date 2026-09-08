import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mutationSurfaces = [
	'src/routes/management/people/+page.svelte',
	'src/routes/financing/projects/+page.svelte',
	'src/routes/financing/projects/[id]/+page.svelte',
	'src/routes/profile/+page.svelte',
	'src/routes/financing/sop/+page.svelte',
	'src/routes/financing/sop/[id]/+page.svelte',
	'src/routes/financing/sop/reminders/+page.svelte',
	'src/lib/financing/DataAdminTable.svelte'
];

test('authenticated layout owns one global message surface', async () => {
	const [layout, component] = await Promise.all([
		readFile(new URL('../../src/routes/+layout.svelte', import.meta.url), 'utf8'),
		readFile(new URL('../../src/lib/GlobalMessages.svelte', import.meta.url), 'utf8')
	]);

	assert.match(layout, /import GlobalMessages from ['"]\$lib\/GlobalMessages\.svelte['"]/);
	assert.equal((layout.match(/<GlobalMessages\s*\/>/g) ?? []).length, 1);
	assert.match(component, /position:\s*fixed/);
	assert.match(component, /justify-items:\s*center/);
	assert.match(component, /pointer-events:\s*none/);
	assert.match(component, /\.global-message[\s\S]*pointer-events:\s*auto/);
});

test('global messages auto-dismiss, pause for interaction, and can be closed', async () => {
	const [store, component] = await Promise.all([
		readFile(new URL('../../src/lib/global-messages.ts', import.meta.url), 'utf8'),
		readFile(new URL('../../src/lib/GlobalMessages.svelte', import.meta.url), 'utf8')
	]);

	assert.match(store, /const DEFAULT_DURATION = 4500/);
	assert.match(store, /setTimeout\(\(\) => dismiss\(id\), duration\)/);
	assert.match(store, /function pause\(id: string, reason:/);
	assert.match(store, /function resume\(id: string, reason:/);
	assert.match(component, /onpointerenter=\{\(\) => globalMessages\.pause\(item\.id, ['"]pointer['"]\)\}/);
	assert.match(component, /onpointerleave=\{\(\) => globalMessages\.resume\(item\.id, ['"]pointer['"]\)\}/);
	assert.match(component, /onfocusin=\{\(\) => globalMessages\.pause\(item\.id, ['"]focus['"]\)\}/);
	assert.match(component, /onclick=\{\(\) => globalMessages\.dismiss\(item\.id\)\}/);
	assert.match(component, /aria-label=\{`关闭通知：\$\{item\.message\}`\}/);
});

test('mutation feedback uses the global surface instead of page-flow banners', async () => {
	for (const file of mutationSurfaces) {
		const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
		assert.match(source, /globalMessages\.(?:success|error|warning|info)\(/, `${file} must publish global messages`);
		assert.doesNotMatch(source, /action-feedback|form-feedback|table-feedback|class="feedback/, `${file} must not render an inline system-message banner`);
	}
});
