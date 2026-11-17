// The model does not style (D9). This module is the one place that defines what counts as
// styling: it removes the model's styling from a spec, then applies the theme as the spec's
// `config`, so every chart looks the same whatever the model wrote.

import type { Theme } from "../contracts/index.ts";
import { forEachView, isPlainObject, joinLocation, type SpecObject } from "./spec-tree.ts";

/** Top-level keys that only style the chart. `config` is replaced by the theme. */
const stylingTopLevelKeys = ["config", "background", "padding"];

/** Mark properties that set colour or type. Shape and layout properties are kept. */
const stylingMarkKeys = ["color", "fill", "stroke", "font", "fontSize", "fontWeight", "fontStyle"];

/** Encoding channels whose fixed values or scale ranges would override the palette. */
const colourChannels = ["color", "fill", "stroke"];
const colourScaleKeys = ["scheme", "range"];

/** In titles, axes, legends, and headers, any property about fonts or colours is styling. */
const guideStylingKey = /font|color/i;
const guideKeys = ["axis", "legend", "header", "title"];

/** Removes styling in place and returns where it was found, for a note to the model. */
export function stripStyling(spec: SpecObject): string[] {
  const removed: string[] = [];
  for (const key of stylingTopLevelKeys) {
    if (key in spec) {
      delete spec[key];
      removed.push(key);
    }
  }
  forEachView(spec, (view, location) => {
    stripMarkStyling(view, location, removed);
    stripGuideStyling(view, "title", location, removed);
    stripEncodingStyling(view, location, removed);
  });
  return removed;
}

function stripMarkStyling(view: SpecObject, location: string, removed: string[]): void {
  if (!isPlainObject(view.mark)) return;
  removeKeys(view.mark, stylingMarkKeys, joinLocation(location, "mark"), removed);
}

function stripEncodingStyling(view: SpecObject, location: string, removed: string[]): void {
  if (!isPlainObject(view.encoding)) return;
  const encoding = view.encoding;
  for (const [channel, definition] of Object.entries(encoding)) {
    if (!isPlainObject(definition)) continue;
    const channelLocation = joinLocation(location, `encoding.${channel}`);
    for (const guide of guideKeys) stripGuideStyling(definition, guide, channelLocation, removed);
    if (!colourChannels.includes(channel)) continue;
    if (isPlainObject(definition.scale)) {
      removeKeys(definition.scale, colourScaleKeys, `${channelLocation}.scale`, removed);
    }
    if ("value" in definition) {
      // A fixed colour is the whole channel; without it the channel says nothing.
      delete encoding[channel];
      removed.push(`${channelLocation}.value`);
    }
  }
}

function stripGuideStyling(
  owner: SpecObject,
  guideKey: string,
  location: string,
  removed: string[],
): void {
  const guide = owner[guideKey];
  if (!isPlainObject(guide)) return;
  const keys = Object.keys(guide).filter((key) => guideStylingKey.test(key));
  removeKeys(guide, keys, joinLocation(location, guideKey), removed);
}

function removeKeys(owner: SpecObject, keys: string[], location: string, removed: string[]): void {
  for (const key of keys) {
    if (key in owner) {
      delete owner[key];
      removed.push(`${location}.${key}`);
    }
  }
}

/** The theme as a Vega-Lite `config`. Page size, logo, and footer are the renderer's share. */
export function themeConfig(theme: Theme): SpecObject {
  const font = theme.fontFamily;
  return {
    font,
    background: "white",
    range: { category: theme.palette },
    mark: { color: theme.palette[0] },
    view: { stroke: "transparent" },
    title: { fontSize: 16, anchor: "start", offset: 12 },
    axis: { labelFontSize: 11, titleFontSize: 12, gridColor: "#e6e6e6", domainColor: "#888888" },
    legend: { labelFontSize: 11, titleFontSize: 12 },
  };
}

export function applyTheme(spec: SpecObject, theme: Theme): SpecObject {
  return { ...spec, config: themeConfig(theme) };
}
