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

const creditInstitutionChangesSchema = z.object({
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
}).partial().strict();

const creditItemChangesSchema = z.object({
  type: z.enum(creditItemTypes),
  limitAmount: nullableLimit.optional(),
  usedAmount: nullableAmount.optional(),
  details: nullableText(4_000).optional(),
}).strict().superRefine((value, context) => {
  if (!("limitAmount" in value) && !("usedAmount" in value) && !("details" in value)) {
    context.addIssue({
      code: "custom",
      message: "授信分项至少需要一个变更字段",
    });
  }
});

export const creditInstitutionUpdateSchema = z.object({
  reportDate: isoDate,
  institutionName: z.string().trim().min(1).max(200),
  changes: z.object({
    institution: creditInstitutionChangesSchema.optional(),
    items: z.array(creditItemChangesSchema).max(creditItemTypes.length).optional(),
  }).strict(),
}).superRefine((value, context) => {
  const institutionChanges = value.changes.institution ?? {};
  const itemChanges = value.changes.items ?? [];
  if (!Object.keys(institutionChanges).length && !itemChanges.length) {
    context.addIssue({
      code: "custom",
      path: ["changes"],
      message: "至少需要一个授信变更字段",
    });
  }
  const itemTypes = new Set(itemChanges.map((item) => item.type));
  if (itemTypes.size !== itemChanges.length) {
    context.addIssue({
      code: "custom",
      path: ["changes", "items"],
      message: "同一授信分项不能重复更新",
    });
  }
});

export type CreditInstitutionChanges = z.infer<
  typeof creditInstitutionChangesSchema
>;

export type CreditItemChanges = z.infer<typeof creditItemChangesSchema>;

export type CreditInstitutionUpdateInput = z.infer<
  typeof creditInstitutionUpdateSchema
>;
