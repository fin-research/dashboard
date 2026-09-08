export const ROLE_DEFINITIONS = [
  { code: "admin", label: "管理员", description: "负责系统配置与人员管理" },
  { code: "handler", label: "经办", description: "负责融资事项经办" },
  { code: "reviewer", label: "复核", description: "负责业务复核与质量把关" },
] as const;

export type RoleCode = (typeof ROLE_DEFINITIONS)[number]["code"];

export const ROLE_LABELS: Record<RoleCode, string> = Object.fromEntries(
  ROLE_DEFINITIONS.map((role) => [role.code, role.label]),
) as Record<RoleCode, string>;

export function roleLabel(role: string | null | undefined) {
  return ROLE_LABELS[role as RoleCode] ?? "未配置角色";
}
