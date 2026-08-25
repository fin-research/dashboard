export function portal(
  node: HTMLElement,
  targetSelector: string | null | undefined,
): { update: (selector: string | null | undefined) => void } {
  function move(selector: string | null | undefined): void {
    if (!selector) return;
    document.querySelector<HTMLElement>(selector)?.append(node);
  }

  move(targetSelector);
  return { update: move };
}
