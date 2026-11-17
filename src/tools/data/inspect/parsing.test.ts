// Unit tests for the pieces under inspect_data: header detection, cell ranges, the
// .docx walker, .xls date conversion, and delimited line splitting.

import { describe, expect, it } from "vitest";
import { serialToIsoDate } from "../../../shared/excel-dates.ts";
import { columnLetters, columnNumber, parseCellRange } from "./cell-range.ts";
import { headingLevelsByStyle, parseDocument } from "./docx-document.ts";
import { detectHeaderRow } from "./header-detection.ts";
import { gridToRows, headerNames, numbersFromText } from "./row-grid.ts";
import { splitDelimitedLine } from "./table-plans.ts";

describe("detectHeaderRow", () => {
  it("skips a title block and blank rows", () => {
    expect(
      detectHeaderRow([
        ["Sales report", null, null],
        [null, null, null],
        ["Region", "Amount", "Date"],
        ["north", "10", "2024-01-01"],
      ]),
    ).toBe(3);
  });

  it("skips a wide numeric row above the labels", () => {
    expect(
      detectHeaderRow([
        ["2024", "2025", "2026"],
        ["Plan", "Actual", "Gap"],
        ["1", "2", "3"],
      ]),
    ).toBe(2);
  });

  it("falls back to the first wide row when nothing reads as labels", () => {
    expect(
      detectHeaderRow([
        ["1", "2"],
        ["3", "4"],
      ]),
    ).toBe(1);
  });
});

describe("cell ranges", () => {
  it("converts column letters both ways", () => {
    expect(columnNumber("A")).toBe(1);
    expect(columnNumber("AA")).toBe(27);
    expect(columnLetters(28)).toBe("AB");
    expect(columnLetters(16_384)).toBe("XFD");
    expect(parseCellRange("B3:F1200")).toEqual({
      firstColumn: 2,
      firstRow: 3,
      lastColumn: 6,
      lastRow: 1200,
    });
  });
});

describe("row grids", () => {
  it("names blank and repeated headers, and drops empty rows", () => {
    expect(headerNames(["Name", null, "name", "Total"], 5)).toEqual([
      "Name",
      "column_2",
      "name_2",
      "Total",
      "column_5",
    ]);
    const grid = gridToRows(
      [
        ["id", "value"],
        [1, "a"],
        [null, ""],
        [2, 3],
      ],
      1,
    );
    // "value" mixes text and a number, so it is stored as text throughout.
    expect(grid.rows).toEqual([
      { id: 1, value: "a" },
      { id: 2, value: "3" },
    ]);
  });

  it("turns all-number text columns into numbers", () => {
    const grid = numbersFromText(
      gridToRows(
        [
          ["a", "b"],
          ["1,200", "x"],
          ["-3.5", "4"],
        ],
        1,
      ),
    );
    expect(grid.rows).toEqual([
      { a: 1200, b: "x" },
      { a: -3.5, b: "4" },
    ]);
  });
});

describe(".docx walker", () => {
  const styles = `<w:styles>
    <w:style w:styleId="Kop1"><w:name w:val="heading 1"/></w:style>
    <w:style w:styleId="Custom"><w:name w:val="Fancy"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>
  </w:styles>`;

  it("reads headings by style name or outline level, and tables with merged cells", () => {
    const levels = headingLevelsByStyle(styles);
    expect(levels).toEqual(
      new Map([
        ["Kop1", 1],
        ["Custom", 3],
      ]),
    );
    const body = `<?xml version="1.0"?><w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Kop1"/></w:pPr><w:r><w:t>Results &amp; plans</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Custom"/></w:pPr><w:r><w:t>Detail</w:t></w:r></w:p>
      <w:tbl>
        <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Wide</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>East</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>
              <w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>nested</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr>
      </w:tbl>
    </w:body></w:document>`;
    const structure = parseDocument(body, levels);
    expect(structure.headings).toEqual([
      { level: 1, text: "Results & plans" },
      { level: 3, text: "Detail" },
    ]);
    expect(structure.tables).toEqual([
      {
        number: 1,
        underHeading: "Detail",
        grid: [
          ["Wide", ""],
          ["East", "1"],
          ["East", "2 nested"],
        ],
      },
    ]);
  });
});

describe("serialToIsoDate", () => {
  it("converts Excel serials in UTC, with no time-zone shift", () => {
    expect(serialToIsoDate(45306, false)).toBe("2024-01-15");
    expect(serialToIsoDate(45306.4375, false)).toBe("2024-01-15 10:30:00");
    expect(serialToIsoDate(43844, true)).toBe("2024-01-15");
  });
});

describe("splitDelimitedLine", () => {
  it("keeps quoted delimiters and doubled quotes inside a field", () => {
    expect(splitDelimitedLine('a,"b, c","say ""hi""",', ",")).toEqual([
      "a",
      "b, c",
      'say "hi"',
      "",
    ]);
  });
});
