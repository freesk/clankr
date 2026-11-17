// Walking a Vega-Lite spec: a view can hold child views under a few keys, and the cleanup
// steps (styling, external references, field checks) all need to visit every view.

export type SpecObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is SpecObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const childViewArrayKeys = ["layer", "hconcat", "vconcat", "concat"];

/** Child views of one view, with their location for error messages, for example "layer[1]". */
export function childViews(
  view: SpecObject,
  location: string,
): { view: SpecObject; location: string }[] {
  const children: { view: SpecObject; location: string }[] = [];
  for (const key of childViewArrayKeys) {
    const value = view[key];
    if (!Array.isArray(value)) continue;
    value.forEach((child, index) => {
      if (isPlainObject(child))
        children.push({ view: child, location: joinLocation(location, `${key}[${index}]`) });
    });
  }
  // Facet and repeat wrap a single child view under "spec".
  if (isPlainObject(view.spec))
    children.push({ view: view.spec, location: joinLocation(location, "spec") });
  return children;
}

/** Calls `visit` on the view and every view nested in it. */
export function forEachView(
  root: SpecObject,
  visit: (view: SpecObject, location: string) => void,
  location = "",
): void {
  visit(root, location);
  for (const child of childViews(root, location)) forEachView(child.view, visit, child.location);
}

export function joinLocation(parent: string, child: string): string {
  if (!parent) return child;
  return child.startsWith("[") ? `${parent}${child}` : `${parent}.${child}`;
}

/** A deep copy, so cleanup steps can edit the spec without touching what the isolate returned. */
export function cloneSpec(spec: SpecObject): SpecObject {
  return structuredClone(spec);
}
