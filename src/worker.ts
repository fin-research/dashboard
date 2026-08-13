const DASHBOARD_PREFIX = "/dashboard";

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (
      url.pathname !== DASHBOARD_PREFIX &&
      !url.pathname.startsWith(`${DASHBOARD_PREFIX}/`)
    ) {
      return new Response("Not Found", { status: 404 });
    }

    url.pathname = url.pathname.slice(DASHBOARD_PREFIX.length) || "/";
    return env.ASSETS.fetch(new Request(url, request));
  },
} satisfies ExportedHandler<Env>;
