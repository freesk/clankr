// samples/sales_2025.csv: a year of orders for a fictional outdoor-goods shop.
// A few segments are blank, and discount_pct mixes numbers with "n/a" so the
// profile reports a mixed column.

import type { DataRow } from "../datasets.ts";
import { seededRandom } from "../seeded-random.ts";

export const salesColumns = [
  "order_id",
  "order_date",
  "region",
  "product",
  "units",
  "unit_price",
  "discount_pct",
  "customer_segment",
];

export const salesRowCount = 2_000;

export const salesRegionNames = ["North", "South", "East", "West", "Central"] as const;

/** Every product has one list price all year, so revenue is units times price. */
export const salesProductPrices: Record<string, number> = {
  "Trail Lantern": 24.99,
  "Canvas Tote": 18.5,
  "Camp Mug": 9.75,
  "Rain Shell": 89,
  "Wool Beanie": 21.25,
  "Folding Stool": 34.4,
};

const segments = ["Consumer", "Small Business", "Enterprise", "Education"] as const;
const discounts = [0, 0, 0, 5, 10, 15] as const;
const millisecondsPerDay = 86_400_000;
const firstDay = Date.UTC(2025, 0, 1);

export function salesRows(): DataRow[] {
  const random = seededRandom(2025);
  const products = Object.keys(salesProductPrices);
  const rows: DataRow[] = [];
  for (let index = 0; index < salesRowCount; index++) {
    // Orders are spread evenly over the year and stay in date order.
    const dayOfYear = Math.floor((index * 365) / salesRowCount);
    const product = random.pick(products);
    rows.push({
      order_id: `SO-${10_001 + index}`,
      order_date: new Date(firstDay + dayOfYear * millisecondsPerDay).toISOString().slice(0, 10),
      region: random.pick(salesRegionNames),
      product,
      units: random.integer(1, 12),
      unit_price: salesProductPrices[product] ?? 0,
      discount_pct: random.chance(0.03) ? "n/a" : random.pick(discounts),
      customer_segment: random.chance(0.01) ? "" : random.pick(segments),
    });
  }
  return rows;
}
