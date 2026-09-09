<script lang="ts">
  import '../app.css';
  import '../styles.css';
  import { onMount, setContext, untrack } from "svelte";
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { pageRequiresLogin } from '$lib/auth-navigation';
  import { createClientNavigationGuard, requireClientLogin, isLoginRedirecting } from '$lib/auth-client';
  import { createClientSession, CLIENT_SESSION_CONTEXT } from '$lib/client-session';
  import { globalMessages } from '$lib/global-messages';

  import GlobalMessages from "$lib/GlobalMessages.svelte";
  import { applyPreferences, readPreferences } from "$lib/preferences";

  let { children, data } = $props();
  const session = createClientSession(untrack(() => data.session));
  setContext(CLIENT_SESSION_CONTEXT, session);
  setContext('site-account', () => $session?.account ?? null);
  setContext('site-account-checking', () => $session === null);
  $effect(() => { if (data.session) session.seed(data.session); });

  beforeNavigate(createClientNavigationGuard(session, {
    origin: () => page.url.origin,
    navigate: (url) => goto(url),
    error: (message) => globalMessages.error(message),
  }));

  onMount(() => {
    applyPreferences(readPreferences());
    // Authenticated SSR already seeded this store. Public pages bootstrap once in
    // the background without making report rendering depend on Auth0.
    void session.load().then(() => {
      if (pageRequiresLogin(page.url.pathname)) {
        return requireClientLogin(page.url.pathname + page.url.search + page.url.hash, session);
      }
    }).catch((error) => { if (!isLoginRedirecting()) globalMessages.error(error.message); });
  });
</script>

<GlobalMessages />
{@render children()}
