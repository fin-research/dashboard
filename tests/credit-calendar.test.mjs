import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {creditLimitFilterLabels,matchesCreditCalendarEvent} from '../src/lib/credit/calendar.ts';
import {creditItemTypes} from '../src/lib/credit/types.ts';

const limit=kind=>({type:kind==='expiry'||kind==='revoked'?'expiry':'added',kind});
const usage=itemType=>({type:'usage',kind:'usage',itemType,label:'不从文案推断分项'});

test('额度和已用默认均为全部，两组独立多选且额度续作扩额合并筛选',()=>{
  assert.deepEqual(Object.values(creditLimitFilterLabels),['新增','到期','续作/扩额','撤销']);
  for(const kind of ['new','expiry','renewal','increase','revoked','decrease','amendment']) {
    assert.equal(matchesCreditCalendarEvent(limit(kind),[],[]),true);
    assert.equal(matchesCreditCalendarEvent(limit(kind),['new','expiry'],['other']),['new','expiry'].includes(kind));
    assert.equal(matchesCreditCalendarEvent(limit(kind),['renewal_or_increase'],[]),['renewal','increase'].includes(kind));
  }
  for(const item of creditItemTypes) {
    assert.equal(matchesCreditCalendarEvent(usage(item),[],[]),true);
    assert.equal(matchesCreditCalendarEvent(usage(item),['revoked'],['bond_investment','yield_certificate']),['bond_investment','yield_certificate'].includes(item));
  }
  assert.equal(matchesCreditCalendarEvent(usage(undefined),[],['other']),false);
});

test('真实授信日历组件支持两组多选、恢复全部和切月保持筛选',async()=>{
  const {stdout}=await promisify(execFile)(process.execPath,['--conditions=browser','tests/helpers/credit-calendar-ui.mjs'],{cwd:new URL('../',import.meta.url),timeout:60_000});
  assert.match(stdout,/Credit calendar multi-select checks passed/);
});
