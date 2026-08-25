import { currentReportDate } from "../../report-date.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `/fund-report/${currentReportDate()}.html`,
      "Cache-Control": "no-store",
    },
  });
