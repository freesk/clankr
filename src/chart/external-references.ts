// No external references (specs/chart.md): a spec may not point at a URL for data or an image.
// Rejected here, before the spec reaches the browser; the browser blocks requests too, as the
// second layer.

import { isPlainObject, joinLocation, type SpecObject } from "./spec-tree.ts";

/** Returns the location of the first external reference, or undefined when there is none. */
export function findExternalReference(spec: SpecObject): string | undefined {
  return search(spec, "");
}

function search(value: unknown, location: string): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = search(item, `${location}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (!isPlainObject(value)) return undefined;
  if (isImageMark(value.mark)) return joinLocation(location, "mark");
  for (const [key, item] of Object.entries(value)) {
    const itemLocation = joinLocation(location, key);
    // `url` is how Vega-Lite names every external resource: data files and image marks.
    if (key === "url") return itemLocation;
    const found = search(item, itemLocation);
    if (found) return found;
  }
  return undefined;
}

function isImageMark(mark: unknown): boolean {
  return mark === "image" || (isPlainObject(mark) && mark.type === "image");
}

export function externalReferenceMessage(location: string): string {
  return `${location} points outside the chart. Charts cannot load URLs or images; pass the rows as render(spec, data("rN")) and remove ${location}.`;
}
