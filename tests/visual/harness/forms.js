// Component fixture only: submission has no server or delivery side effects.
// Real action authorization and fan-out are verified in server/Worker tests.
export function enhance(form) {
  const prevent = event => event.preventDefault();
  form.addEventListener('submit', prevent);
  return {destroy: () => form.removeEventListener('submit', prevent)};
}
