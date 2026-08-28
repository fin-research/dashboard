import { z } from "zod";

import {
  creditItemTypes,
  creditStatuses,
} from "./types.ts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}, "日期无效");
const nullableDate = isoDate.nullable();
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const nullableAmount = z.number().finite().nullable();
const nullableLimit = z.number().finite().nonnegative().nullable();

export const creditInstitutionUpdateSchema = z.object({
  reportDate: isoDate,
  institutionName: z.string().trim().min(1).max(200),
  expectedUpdatedAt: z.string().datetime(),
  institution: z.object({
    institutionType: z.string().trim().min(1).max(100),
    confidentialityStatus: z.enum(["signed", "not_signed", "unknown"]),
    status: z.enum(creditStatuses),
    includedInWeeklyReport: z.boolean(),
    totalLimit: nullableLimit,
    totalUsed: nullableAmount,
    effectiveDate: nullableDate,
    expiryDate: nullableDate,
    bankOffice: nullableText(500),
    applyingDepartment: nullableText(500),
    handler: nullableText(200),
    notes: nullableText(4_000),
    bondPreference: nullableText(4_000),
    usageDetails: nullableText(8_000),
    items: z.array(z.object({
      type: z.enum(creditItemTypes),
      limitAmount: nullableLimit,
      usedAmount: nullableAmount,
      details: nullableText(4_000),
    })).length(creditItemTypes.length),
  }),
}).superRefine((value, context) => {
  const itemTypes = new Set(value.institution.items.map((item) => item.type));
  if (itemTypes.size !== creditItemTypes.length) {
    context.addIssue({
      code: "custom",
      path: ["institution", "items"],
      message: "授信分项类型必须完整且不能重复",
    });
  }
  if (
    value.institution.effectiveDate &&
    value.institution.expiryDate &&
    value.institution.effectiveDate > value.institution.expiryDate
  ) {
    context.addIssue({
      code: "custom",
      path: ["institution", "expiryDate"],
      message: "授信到期日不能早于生效日",
    });
  }
});

export type CreditInstitutionUpdateInput = z.infer<
  typeof creditInstitutionUpdateSchema
>;
