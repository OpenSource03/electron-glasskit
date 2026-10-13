const ids = new WeakMap<HTMLElement, number>();
let count = 0;

/** Stable per element, so rebinding it keeps native state such as typed text. */
export function itemKey(kind: "region" | "island", element: HTMLElement): string {
  let id = ids.get(element);
  if (id === undefined) {
    id = ++count;
    ids.set(element, id);
  }
  return `${kind}:${id}`;
}
