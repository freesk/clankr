// samples/inventory.tsv: stock per product and warehouse, with a two-line report
// title above the header row.

import type { DataRow } from "../datasets.ts";
import { roundToCents, seededRandom } from "../seeded-random.ts";

export const inventoryTitleLines = [
  "Bramblewood Outfitters - warehouse stock report",
  "Counted 2025-12-31. Fictional data.",
];

export const inventoryColumns = [
  "sku",
  "product",
  "category",
  "warehouse",
  "on_hand",
  "reorder_point",
  "unit_cost",
  "last_counted",
];

export const inventoryWarehouses = ["Reno", "Columbus", "Savannah"] as const;

const productsByCategory: Record<string, string[]> = {
  Lighting: ["Trail Lantern", "Headlamp", "String Lights", "Candle Lantern"],
  Bags: ["Canvas Tote", "Day Pack", "Dry Bag", "Hip Pack", "Duffel"],
  Kitchen: ["Camp Mug", "Enamel Plate", "Spork Set", "Kettle", "Cutting Board"],
  Apparel: ["Rain Shell", "Wool Beanie", "Fleece Vest", "Sun Hat", "Hiking Socks", "Gaiters"],
  Furniture: ["Folding Stool", "Camp Chair", "Roll Table", "Hammock"],
};

const countDays = ["2025-12-29", "2025-12-30", "2025-12-31"] as const;

export function inventoryRows(): DataRow[] {
  const random = seededRandom(1207);
  const rows: DataRow[] = [];
  let skuNumber = 100;
  for (const [category, products] of Object.entries(productsByCategory)) {
    for (const product of products) {
      skuNumber++;
      const unitCost = roundToCents(random.integer(300, 6_000) / 100);
      for (const warehouse of inventoryWarehouses) {
        rows.push({
          sku: `BW-${skuNumber}`,
          product,
          category,
          warehouse,
          on_hand: random.chance(0.08) ? 0 : random.integer(5, 400),
          reorder_point: random.pick([20, 25, 40, 50, 75]),
          unit_cost: unitCost,
          last_counted: random.pick(countDays),
        });
      }
    }
  }
  return rows;
}
