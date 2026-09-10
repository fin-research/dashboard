export type EconomicIndicatorRequestDetails = {
  path: string;
  parameters: Record<string, string>;
  stage: string;
  status?: number;
  statusText?: string;
  contentType?: string;
  requestId?: string;
  responseBody?: string;
  responseTruncated?: boolean;
  cause?: { name: string; message: string };
};

export class EconomicIndicatorRequestError extends Error {
  readonly details: EconomicIndicatorRequestDetails;
  constructor(details: EconomicIndicatorRequestDetails) {
    // Workflow persists Error.message for every attempt; custom properties alone
    // do not survive its serialization boundary.
    super(JSON.stringify(details));
    this.name = "EconomicIndicatorRequestError";
    this.details = details;
  }
}

export function redactEconomicIndicatorError(text: string): string {
  return text
    .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/\b((?:[\w-]*(?:token|secret|password|passwd|cookie|authorization|credential|signature)|sign|device_id)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;<>]+)/gi, "$1[REDACTED]");
}

export function economicIndicatorErrorDetails(error: unknown): { name: string; message: string } {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: redactEconomicIndicatorError(error instanceof Error ? error.message : String(error)).slice(0, 32_000),
  };
}

export async function requestEconomicIndicatorData(
  data: { fetch(request: Request): Promise<Response> },
  path: string,
  parameters: URLSearchParams,
): Promise<unknown> {
  const url = new URL(`https://eastmoney.hasbai.xyz/data${path}`);
  url.search = parameters.toString();
  // Parameters here are the EDB/funding query allowlist, never signed upstream URLs.
  const details: EconomicIndicatorRequestDetails = {
    path, parameters: Object.fromEntries(parameters), stage: "fetch",
  };
  let response: Response;
  try {
    response = await data.fetch(new Request(url, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(90_000),
    }));
  } catch (error) {
    throw new EconomicIndicatorRequestError({ ...details, cause: economicIndicatorErrorDetails(error) });
  }
  Object.assign(details, {
    status: response.status, statusText: response.statusText,
    contentType: response.headers.get("Content-Type") ?? "",
    requestId: response.headers.get("CF-Ray") ?? response.headers.get("X-Request-Id") ?? "",
  });
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  const limit = response.ok ? 8 * 1024 * 1024 : 24_000;
  let text = "";
  let bytes = 0;
  let truncated = false;
  try {
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value.subarray(0, limit + 1 - bytes), { stream: true });
      bytes += chunk.value.byteLength;
      if (bytes > limit) { truncated = true; break; }
    }
    text += decoder.decode();
  } catch (error) {
    throw new EconomicIndicatorRequestError({ ...details, stage: "read_response",
      responseBody: redactEconomicIndicatorError(text).slice(0, 24_000),
      responseTruncated: truncated, cause: economicIndicatorErrorDetails(error) });
  } finally {
    await reader?.cancel().catch(() => undefined);
  }
  if (!response.ok || truncated) {
    throw new EconomicIndicatorRequestError({ ...details,
      stage: response.ok ? "response_size" : "http_response",
      responseBody: redactEconomicIndicatorError(text).slice(0, 24_000), responseTruncated: truncated });
  }
  try { return JSON.parse(text); }
  catch (error) {
    throw new EconomicIndicatorRequestError({ ...details, stage: "decode_json",
      responseBody: redactEconomicIndicatorError(text).slice(0, 24_000),
      responseTruncated: text.length > 24_000, cause: economicIndicatorErrorDetails(error) });
  }
}
