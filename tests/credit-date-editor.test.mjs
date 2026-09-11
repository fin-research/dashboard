import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';

test('日期手输中间值不提交，起止日期组合校验后保存，金额编辑正常',async()=>{
  const {stdout}=await promisify(execFile)(process.execPath,['--conditions=browser','tests/helpers/credit-date-editor-ui.mjs'],{cwd:new URL('../',import.meta.url),timeout:60_000});
  assert.match(stdout,/Credit date editor checks passed/);
});
