export type ReportView = "visual" | "text";

const DASHBOARD_PATH = "/dashboard";
const TEXT_REPORT_PATH = `${DASHBOARD_PATH}/text`;

export function reportViewFromPathname(pathname: string): ReportView {
  return pathname === TEXT_REPORT_PATH || pathname === `${TEXT_REPORT_PATH}/`
    ? "text"
    : "visual";
}

export function pathnameForReportView(view: ReportView): string {
  return view === "text" ? TEXT_REPORT_PATH : DASHBOARD_PATH;
}
