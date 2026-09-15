import assert from 'node:assert/strict';
import test from 'node:test';
import { blankInquiry, directoryKey, inheritRow, invalidField, quotePrice, remember, shiborTenor, suggestions, tenorDays } from '../src/lib/trading-workflow/inquiries.ts';
const row = { ...blankInquiry(), counterparty:'工商银行', trader:'张三', tenor:'3', amount:'1.5', price:'10' };
const rates = [{ publishDate:'2026-09-15', publishedAt:'2026-09-15T11:00:00+08:00', tenor:'1W', rate:1.5 }];
test('loan quotes round tenor up and convert only against the published rate for that day', () => {
  assert.equal(shiborTenor('3D'),'1W'); assert.equal(shiborTenor('10天'),'2W'); assert.equal(shiborTenor('7'),'1W');
  assert.equal(shiborTenor('31'),'3M'); assert.equal(shiborTenor('366'),null); assert.equal(tenorDays('2W'),14);
  assert.equal(quotePrice(row,true,rates,'2026-09-15',new Date('2026-09-15T10:59:59+08:00')),'-10BP');
  assert.equal(quotePrice(row,true,rates,'2026-09-15',new Date('2026-09-15T11:00:00+08:00')),'1.4000%');
  assert.equal(quotePrice(row,true,rates,'2026-09-16',new Date('2026-09-16T12:00:00+08:00')),'-10BP');
  assert.equal(quotePrice({...row,price:'0'},true,rates,'2026-09-15',new Date('2026-09-15T12:00:00+08:00')),'1.5000%');
  assert.equal(quotePrice({...row,price:'1.45'},false,[], '2026-09-15',new Date()),'1.45%');
});
test('numeric omissions inherit the preceding row, retaining explicit zero and independent counterparties', () => {
  const next = inheritRow({...blankInquiry(),counterparty:'招商银行',price:'0'},row);
  assert.equal(next.tenor,'3'); assert.equal(next.amount,'1.5'); assert.equal(next.price,'0'); assert.equal(next.trader,'');
  assert.equal(invalidField(next,false),null); assert.equal(invalidField(next,true),'trader');
  assert.equal(invalidField({...row,price:'abc'},true),'price');
});
test('names match text, pinyin initials and partial initials; dictionary remains actor scoped', () => {
  const directory = remember({counterparties:[],traders:[]},row);
  assert.deepEqual(suggestions(directory.counterparties,'gsyh'),['工商银行']);
  assert.deepEqual(suggestions(directory.counterparties,'工商'),['工商银行']);
  assert.deepEqual(suggestions(directory.traders,'zs'),['张三']);
  assert.equal(remember(directory,row).counterparties.length,1);
  assert.notEqual(directoryKey('a'),directoryKey('b'));
});
