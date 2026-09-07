import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { compile } from "svelte/compiler";
import { Window } from "happy-dom";

// Vite accepts extensionless TypeScript imports; reproduce that resolution in
// the DOM-test subprocess without changing production modules for Node.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("$lib/")) {
    const pathname = specifier.slice(5);
    return nextResolve(new URL("../../src/lib/" + pathname + (/\.[a-z]+$/.test(pathname) ? "" : ".ts"), import.meta.url).href, context);
  }
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/.test(specifier)) return nextResolve(specifier + ".ts", context);
    throw error;
  }
} });

export function installDom() {
  const window = new Window({ url: "http://localhost/credit-workbench/assistant" });
  for (const key of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLMediaElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLDetailsElement", "SVGElement", "Text", "Comment", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent", "MutationObserver", "ResizeObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : typeof window[key] === "function" && /^[a-z]/.test(key) ? window[key].bind(window) : window[key] });
  }
  return window;
}

const root = new URL("../../", import.meta.url);
const cache = new Map();

export async function componentUrl(file, sourceOverride) {
  const url = file instanceof URL ? file : new URL(file, root);
  if (!sourceOverride && cache.has(url.href)) return cache.get(url.href);
  const source = sourceOverride ?? await readFile(url, "utf8");
  let { js } = compile(source, { filename: url.pathname, generate: "client", dev: false });
  let code = js.code;
  const imports = [...code.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)];
  for (const match of imports) {
    const specifier = match[1];
    if (specifier.endsWith(".css")) { code = code.replace(match[0], ""); continue; }
    let resolved;
    if (specifier === "$app/navigation") {
      resolved = new URL(".svelte-kit/dom-tests/app-navigation.mjs", root);
      await mkdir(new URL(".", resolved), { recursive: true });
      await writeFile(resolved, "export function afterNavigate() {} export async function goto(url, options) { globalThis.domNavigations?.push({url, options}); }");
    } else if (specifier.startsWith("$lib/")) resolved = new URL("src/lib/" + specifier.slice(5), root);
    else if (specifier.startsWith(".")) resolved = new URL(specifier, url);
    else resolved = new URL(import.meta.resolve(specifier));
    if (!/\.[a-z]+$/.test(resolved.pathname)) resolved = new URL(resolved.href + ".ts");
    const target = resolved.pathname.endsWith(".svelte") ? await componentUrl(resolved) : resolved.href;
    code = code.replace(match[0], match[0].replace(specifier, target));
  }
  const output = new URL(`.svelte-kit/dom-tests/${createHash("sha256").update(code).digest("hex")}.mjs`, root);
  await mkdir(new URL(".", output), { recursive: true });
  await writeFile(output, code);
  const result = output.href;
  if (!sourceOverride) cache.set(url.href, result);
  return result;
}

export async function loadComponent(file, sourceOverride) {
  return (await import(await componentUrl(file, sourceOverride))).default;
}
