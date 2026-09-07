export interface AccountProfile {
  name: string;
  email: string;
  emailVerified: boolean;
  roles: { name: string; description: string }[];
  permissions: { name: string; description: string; resource: string }[];
}

export const DASHBOARD_PERMISSIONS = ['查看市场研究与资金日报', '上传资金日报与二级池台账', '使用交易研究工作台', '生成与编辑研究内容'];
