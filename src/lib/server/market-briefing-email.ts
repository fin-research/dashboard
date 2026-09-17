import { submitMessage, type MessengerBinding } from "./messenger.ts";

type MailConfig = {
  MESSENGER: MessengerBinding;
  FROM_EMAIL: string;
  MARKET_BRIEFING_RECIPIENTS: string;
};

export async function sendMarketBriefingResult(
  env: MailConfig,
  result: { reportDate: string; instanceId: string; status: "success" | "failed"; detail: string },
): Promise<{ messageId: string; status: "queued" }> {
  const recipients = [...new Set((env.MARKET_BRIEFING_RECIPIENTS ?? "").split(/[;,，；\s]+/).filter(Boolean))];
  if (!env.MESSENGER || !env.FROM_EMAIL || !recipients.length
    || recipients.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error("市场点评邮件配置不完整");
  }
  const label = result.status === "success" ? "已生成" : "生成失败";
  const response = await submitMessage(env.MESSENGER, {
    source: "market-briefing", channel: "email", profile: "market-briefing",
    idempotencyKey: `market-briefing/${result.instanceId}/result`,
    to: recipients,
    subject: `【市场点评】${result.reportDate} ${label}`,
    text: `${result.reportDate} 市场点评${label}\n\n${result.detail}\n\n报告：https://eastmoney.hasbai.xyz/market-briefing?date=${result.reportDate}\n任务：${result.instanceId}`,
  });
  return { messageId: response.id, status: "queued" };
}
