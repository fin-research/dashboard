/** Keep keyboard scrolling available only while the region actually overflows.
 * The caller provides role="region" and an accessible name (MDN CSS overflow).
 */
export function scrollableRegion(node: HTMLElement) {
  const originalTabIndex = node.getAttribute('tabindex');
  const update = () => {
    node.tabIndex = node.scrollWidth > node.clientWidth + 1 ? 0 : -1;
  };
  const observer = new ResizeObserver(update);
  observer.observe(node);
  if (node.firstElementChild) observer.observe(node.firstElementChild);
  update();
  return {
    destroy() {
      observer.disconnect();
      if (originalTabIndex === null) node.removeAttribute('tabindex');
      else node.setAttribute('tabindex', originalTabIndex);
    },
  };
}
