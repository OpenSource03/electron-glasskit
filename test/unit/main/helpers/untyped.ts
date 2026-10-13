/**
 * Builds a value from JSON and claims the type the API declares for it, which is what a
 * JavaScript caller or a page can hand over without the compiler objecting.
 */
export function untyped<Claimed>(json: string): Claimed {
  // JSON.parse is the boundary: the claim is deliberately not checked.
  return JSON.parse(json) as Claimed;
}
