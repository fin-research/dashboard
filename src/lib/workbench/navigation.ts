import type { WorkbenchIconName } from '../trading-research/demo-data';

/** 一级板块、二级页面、三级标签页均以真实 href 为入口。 */
export type PageLink = { label: string; href: string };
export type PageTab = PageLink & { id: string };
export type WorkbenchPageLink = PageTab & {
  icon: WorkbenchIconName;
  permission?: string;
  separatorBefore?: boolean;
};

export const notificationTabs: readonly PageTab[] = [
  { id: 'delivery', label: '消息投递', href: '/management/messenger?tab=delivery' },
  { id: 'test', label: '测试消息', href: '/management/messenger?tab=test' },
];
export function notificationTab(value: string | null): 'delivery' | 'test' {
  return value === 'test' ? 'test' : 'delivery';
}
