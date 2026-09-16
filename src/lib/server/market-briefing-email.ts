import { Resend } from "resend";

type MailConfig = {
  MARKET_BRIEFING_RESEND_API_KEY: string;
  FROM_EMAIL: string;
  MARKET_BRIEFING_RECIPIENTS: string;
};

export async function sendMarketBriefingResult(
  env: MailConfig,
  result: { reportDate: string; instanceId: string; status: "success" | "failed"; detail: string },
): Promise<{ messageId: string; status: "accepted" }> {
  const recipients = [...new Set((env.MARKET_BRIEFING_RECIPIENTS ?? "").split(/[;,，；\s]+/).filter(Boolean))];
  if (!env.MARKET_BRIEFING_RESEND_API_KEY || !env.FROM_EMAIL || !recipients.length
    || recipients.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("市场点评邮件配置不完整");
  }
  const label = result.status === "success" ? "已生成" : "生成失败";
  const response = await new Resend(env.MARKET_BRIEFING_RESEND_API_KEY).emails.send({
    from: env.FROM_EMAIL,
    to: recipients,
    subject: `【市场点评】${result.reportDate} ${label}`,
    text: `${result.reportDate} 市场点评${label}\n\n${result.detail}\n\n报告：https://eastmoney.hasbai.xyz/market-briefing?date=${result.reportDate}\n任务：${result.instanceId}`,
  }, { idempotencyKey: `market-briefing/${result.instanceId}/${result.status}` });
  if (response.error || !response.data?.id) throw new Error(`市场点评邮件发送失败：${response.error?.name ?? "NO_MESSAGE_ID"}`);
  return { messageId: response.data.id, status: "accepted" };
}
