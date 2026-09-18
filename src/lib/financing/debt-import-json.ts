import { z } from 'zod';
import { DebtImportError } from './debt-import-error.ts';

const text = z.string().trim().min(1).max(2000);
const nullableText = text.nullish();
const date = z.iso.date();
const nullableDate = date.nullish();
const money = z.number().finite().nonnegative();
export const debtIdentitySchema = z.object({
  sourceKey: text, table: z.enum(['debt','bond','income_certificate','income_right','refinancing','swap_facility']),
  debtType: z.enum(['债券','收益凭证','收益权转让','同业拆借','集团借款','转融资','互换便利']),
  subtype: nullableText, name: text, legacyName: nullableText, counterparty: nullableText,
  issueDate: nullableDate, maturityDate: nullableDate
});
const extension = z.object({
  issuanceMethod: nullableText, bookbuildingDate: nullableDate, interestBasis: nullableText,
  issuanceTarget: nullableText, market: nullableText, receivingAccount: nullableText,
  trustee: nullableText, bookrunner: nullableText, liquidationSubmissionStatus: nullableText,
  liquidationRegistrationStatus: nullableText, returnType: nullableText, subscriptionDate: nullableDate,
  redemptionDate: nullableDate, earlyMaturity: z.boolean().nullish(), interestBasisDays: z.number().int().nonnegative().nullish(),
  isExtended: z.boolean().nullish(), repaymentAccount: nullableText, averageRepoBalanceDescription: nullableText,
  repoWeightedAverageRate: z.number().finite().nullish()
}).strict();
export const debtSchema = debtIdentitySchema.extend({
  amount: money, interestPayable: money, annualRate: z.number().finite().nullish(),
  activatedAt: nullableDate, settledAt: nullableDate, closedAt: nullableDate, extension
});
const cashflow = z.object({
  sourceKey: text, cashflowType: z.enum(['principal','interest','fee','supplemental']), dueDate: date,
  amount: money.nullable(), paidAmount: money.nullish(), paidAt: nullableDate,
  accrualStartDate: nullableDate, accrualEndDate: nullableDate, note: nullableText,
  sourceSequence: z.number().int().nonnegative().optional(), sequence: z.number().int().nonnegative().optional()
});
const balance = z.object({asOfDate: date, debtType: z.enum(['债券','收益凭证','收益权转让','同业拆借','集团借款','转融资','互换便利']), subtype: z.string().max(200).nullish(), amount: money}).refine(b => b.debtType === '债券' ? ['小公募','次级债','私募债','科创债','短期融资券','公司债'].includes(b.subtype ?? '') : !b.subtype, '余额品种与子类不匹配');
const snapshot = z.object({asOfDate: date, totalYi: money});
export const importPlanSchema = z.object({action: z.literal('plan'), identities: z.array(debtIdentitySchema).min(1).max(100000), snapshot});
export const importCommitSchema = z.object({
  action: z.literal('commit'), version: z.string().min(1).max(200),
  identities: z.array(debtIdentitySchema).min(1).max(100000), snapshot,
  debts: z.array(debtSchema).max(100000), cashflows: z.array(cashflow).max(200000),
  balances: z.array(balance).max(100000), snapshotBalances: z.array(balance).min(1).max(1000)
});
export type ImportCommit = z.infer<typeof importCommitSchema>;
export function validateWorkbook(input: { debts: unknown[]; cashflows: unknown[]; balances: unknown[]; snapshot: unknown }) {
  const parsed = importCommitSchema.parse({...input, action:'commit', version:'local', identities:input.debts, snapshotBalances:input.balances.filter((b: any)=>b.asOfDate === (input.snapshot as any).asOfDate)});
  validateIncrement(parsed);
  return parsed;
}
export function validateIncrement(input: ImportCommit) {
  const identities = new Map(input.identities.map(d=>[d.sourceKey, d]));
  if (identities.size !== input.identities.length) throw new DebtImportError('负债来源键重复');
  const keys = new Set<string>();
  for (const debt of input.debts) {
    if (keys.has(debt.sourceKey)) throw new DebtImportError('新增负债来源键重复');
    keys.add(debt.sourceKey);
    if (JSON.stringify(debtIdentitySchema.parse(debt)) !== JSON.stringify(identities.get(debt.sourceKey))) throw new DebtImportError('新增负债与核对清单不一致');
    const table = {债券:'bond',收益凭证:'income_certificate',收益权转让:'income_right',转融资:'refinancing',互换便利:'swap_facility',同业拆借:'debt',集团借款:'debt'}[debt.debtType];
    if (debt.table !== table) throw new DebtImportError('负债品种与继承表不一致');
  }
  for (const flow of input.cashflows) if (!keys.has(flow.sourceKey)) throw new DebtImportError('现金流没有对应新增负债');
  for (const balances of [input.balances,input.snapshotBalances]) {
    const seen = new Set<string>();
    for (const b of balances) {const key=balanceKey(b);if(seen.has(key)) throw new DebtImportError('余额日期与品种重复');seen.add(key);}
  }
  if(input.snapshotBalances.some(b=>b.asOfDate!==input.snapshot.asOfDate)) throw new DebtImportError('余额基准日不一致');
  for(const b of input.balances.filter(b=>b.asOfDate===input.snapshot.asOfDate)){const expected=input.snapshotBalances.find(s=>balanceKey(s)===balanceKey(b));if(!expected||expected.amount!==b.amount)throw new DebtImportError('新增余额与基准日分项不一致');}
  const total=input.snapshotBalances.reduce((sum,b)=>sum+b.amount,0)/100000000;
  if(Math.abs(total-input.snapshot.totalYi)>0.0001) throw new DebtImportError('余额分项与汇总不一致');
}
export function balanceKey(b: {asOfDate:string;debtType:string;subtype?:string|null}) {return JSON.stringify([b.asOfDate,b.debtType,b.subtype??'']);}


/** Keep historical business values in the browser and send only selected additions. */
export function incrementForPlan(workbook: ImportCommit, rawPlan: unknown): ImportCommit {
  const plan=z.object({version:z.string().min(1).max(200),newKeys:z.array(text).max(100000),balanceKeys:z.array(z.string()).max(100000)}).parse(rawPlan);
  const keys=new Set(plan.newKeys);
  const sourceKeys=new Set(workbook.identities.map(d=>d.sourceKey));
  if(keys.size!==plan.newKeys.length || plan.newKeys.some(key=>!sourceKeys.has(key)))throw new DebtImportError('核对结果包含无效负债，请重新导入');
  const balances=new Set(plan.balanceKeys);
  const increment:ImportCommit={...workbook,version:plan.version,
    debts:workbook.debts.filter(d=>keys.has(d.sourceKey)),cashflows:workbook.cashflows.filter(c=>keys.has(c.sourceKey)),
    balances:workbook.balances.filter(b=>!balances.has(balanceKey(b)))};
  validateIncrement(increment);
  return increment;
}
