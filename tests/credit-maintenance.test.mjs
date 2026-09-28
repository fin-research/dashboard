import assert from 'node:assert/strict';
import test from 'node:test';
import { creditMaintenanceAmounts, creditMaintenanceChanges, creditMaintenanceDraft } from '../src/lib/credit/maintenance.ts';

const row = {
  institutionName:'甲银行',institutionType:'股份行',status:'approved',confidentialityStatus:true,
  reportDate:'2026-09-28',totalLimit:10,effectiveDate:'2026-01-01',expiryDate:'2027-01-01',
  clients:[{id:'1',name:'甲银行'}],items:[
    {type:'bond_investment',limitAmount:5,usedAmount:3,primaryUsedAmount:2,secondaryUsedAmount:1,details:'债券说明'},
    {type:'yield_certificate',limitAmount:3,usedAmount:1,details:null},
    {type:'interbank_lending',limitAmount:2,usedAmount:1,details:null},
    {type:'legal_overdraft',limitAmount:2,usedAmount:0.5,details:null},
    {type:'other',limitAmount:null,usedAmount:0.25,details:'手工记录'},
  ],
};

test('maintenance calculates total and item availability from editable values without inventing an other limit',()=>{
  const draft=creditMaintenanceDraft(row);
  draft.totalLimit=12;
  draft.items.bond_investment.secondaryUsedAmount=2;
  draft.items.legal_overdraft.usedAmount=0.75;
  draft.items.other.usedAmount=0.5;
  draft.items.other.details='补充记录';
  const amount=creditMaintenanceAmounts(row,draft);
  assert.equal(amount.used.bond_investment,4);
  assert.equal(amount.remaining.bond_investment,1);
  assert.equal(amount.remaining.yield_certificate,2);
  assert.equal(amount.remaining.interbank_lending,1);
  assert.equal(amount.remaining.legal_overdraft,1.25);
  assert.equal(amount.remaining.other,null);
  assert.equal(amount.totalUsed,7.25);
  assert.equal(amount.available,4.75);
  const changes=creditMaintenanceChanges(row,draft);
  assert.deepEqual(changes.institution,{totalLimit:12});
  assert.deepEqual(changes.items,[
    {type:'bond_investment',secondaryUsedAmount:2},
    {type:'legal_overdraft',usedAmount:0.75},
    {type:'other',details:'补充记录',usedAmount:0.5},
  ]);
});

test('unlinked clients keep derived finance usage and available amount unknown',()=>{
  const unlinked={...row,clients:[],items:row.items.map(item=>item.type==='bond_investment'?{...item,primaryUsedAmount:null}:item)};
  const amount=creditMaintenanceAmounts(unlinked,creditMaintenanceDraft(unlinked));
  assert.equal(amount.used.bond_investment,null);
  assert.equal(amount.remaining.bond_investment,null);
  assert.equal(amount.totalUsed,null);
  assert.equal(amount.available,null);
});
