// output part. See specs/output.md. The formats a chart or a table can be saved in, how the
// format is chosen (D85), and the Word, Excel, and CSV writers. The tools that use them are
// src/tools/data/make-chart.ts and src/tools/data/export-table.ts.

export { formatCommand } from "./format-command.ts";
export { createPickerFormatPrompter, type Picker } from "./format-picker.ts";
export {
  chartOutputFormats,
  formatFromPath,
  formatsNamedIn,
  tableOutputFormats,
} from "./formats.ts";
export {
  askOutputFormat,
  type ChosenFormat,
  type FormatRequest,
  resolveOutputFormat,
  settledOutputFormat,
} from "./resolve-format.ts";
