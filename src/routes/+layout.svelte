<script lang="ts">
  import { onMount } from "svelte";
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { pageRequiresLogin } from '$lib/auth-navigation';
  import { requireClientLogin, isLoginRedirecting } from '$lib/auth-client';
  import { globalMessages } from '$lib/global-messages';
  import { financingRouteId } from '$lib/financing/route-contract';

  import GlobalMessages from "$lib/GlobalMessages.svelte";
  import { applyPreferences, readPreferences } from "$lib/preferences";

  let { children } = $props();

  let checkedDestination: string | null = null;
  let checkingNavigation = false;
  beforeNavigate(({ to, cancel }) => {
    if (!to || to.url.origin !== page.url.origin || !pageRequiresLogin(to.url.pathname)) return;
    // These SSR routes authenticate in their server loads/middleware. Let Kit reuse
    // layout data and follow its 401 redirect instead of adding a session round trip.
    if (financingRouteId(to.route.id) !== null) return;
    if (checkedDestination === to.url.href) { checkedDestination = null; return; }
    cancel();
    if (checkingNavigation) return;
    checkingNavigation = true;
    void requireClientLogin(to.url.pathname + to.url.search + to.url.hash)
      .then(async (loggedIn) => {
        if (loggedIn) {
          checkedDestination = to.url.href;
          await goto(to.url, { invalidateAll: true });
        }
      })
      .catch((error) => { if (!isLoginRedirecting()) globalMessages.error(error.message); })
      .finally(() => { checkingNavigation = false; checkedDestination = null; });
  });

  onMount(() => {
    applyPreferences(readPreferences());
    if (pageRequiresLogin(page.url.pathname) && financingRouteId(page.route.id) === null) {
      void requireClientLogin(page.url.pathname + page.url.search + page.url.hash)
        .catch((error) => { if (!isLoginRedirecting()) globalMessages.error(error.message); });
    }
  });
</script>

<GlobalMessages />
{@render children()}
