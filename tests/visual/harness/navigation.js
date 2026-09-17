import { onMount } from 'svelte';
/** @param {(event: {from: null, to: {url: URL}, type: string}) => void} callback */
export function afterNavigate(callback) {
  onMount(() => { callback({ from: null, to: { url: new URL(window.location.href) }, type: 'enter' }); });
}
/** @param {string | URL} url */
export function goto(url) { window.location.assign(String(url)); return Promise.resolve(); }

/** Component harness has no SvelteKit router. Browser unload remains native. */
export function beforeNavigate(_callback) {}
