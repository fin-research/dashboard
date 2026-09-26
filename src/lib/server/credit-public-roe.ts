import type { listPublicCreditFiles } from './credit-public-files.ts';

type PublicDocument = Awaited<ReturnType<typeof listPublicCreditFiles>>[number];

// Values read from the named table in the public R2 originals and checked against
// the rendered PDF page. The ETag prevents an updated PDF inheriting old facts.
const auditedRoe = [
  { year: 2023, value: '9.75%', page: 110, etag: '074f1743e4087111415d1ea6d71ff1ec' },
  { year: 2024, value: '11.64%', page: 110, etag: 'c7e65bb5f836592812dd6e3c47cb220c' },
  { year: 2025, value: '13.23%', page: 111, etag: '38c1ac97ef61e3e5700a1498f4f639e4' },
] as const;

export function isRoeQuestion(query: string): boolean {
  return /\bROE\b|净资产收益率|净资产回报率/i.test(query);
}

export function roeQuestionYears(query: string): number[] {
  const years = [...new Set([...query.matchAll(/20\d{2}/g)].map(match => Number(match[0])))];
  if (years.length === 1) return years;
  if (years.length > 1) {
    const first = Math.min(...years), last = Math.max(...years);
    return Array.from({ length: Math.min(last - first + 1, 10) }, (_, index) => first + index);
  }
  if (/近(?:两|2)年|最近(?:两|2)年/.test(query)) return [2024, 2025];
  return auditedRoe.map(item => item.year);
}

export function auditedRoeSources(documents: PublicDocument[], query: string) {
  if (!isRoeQuestion(query) || /非加权|简单平均|算术平均|ROE\s*[（(]平均/i.test(query)) return [];
  const years = new Set(roeQuestionYears(query));
  const byKey = new Map(documents.map(document => [document.key, document]));
  return auditedRoe.flatMap(item => {
    if (!years.has(item.year)) return [];
    const document = byKey.get(`credit/public/${item.year}审计报告.pdf`);
    if (!document || document.etag !== item.etag) return [];
    return [{ title: document.title, url: document.url, authority: document.authority,
      locator: `PDF 第 ${item.page} 页（补充资料第 1 页）`,
      text: `${item.year} 年度，东方财富证券股份有限公司审计报告补充资料“净资产收益率及每股收益”：归属于公司普通股股东的净利润对应的加权平均净资产收益率为 ${item.value}。` }];
  });
}
