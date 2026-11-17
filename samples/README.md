# Sample data

Small, entirely fictional files to try `clankr`'s data tools on (`inspect_data`, `query_sql`, `run_js`, `make_chart`, `export_table`). "Bramblewood Outfitters" and every name, figure, and date in them are made up.

Do not edit these files by hand. They are generated from seeded data in `evals/fixtures/samples/` by `npm run samples`, which writes the same bytes on every run, and `test/samples/` fails if the committed files drift from the generator.

A request to chart or save something makes clankr ask which format to write, unless you name one ("as a Word document", "save it as an Excel file") or start it with `--format`.

| File | What's in it | Try asking clankr |
|---|---|---|
| `sales_2025.csv` | 2,000 orders for 2025: order id, date, region, product, units, unit price, discount, customer segment. A few segments are blank, and `discount_pct` mixes numbers with `n/a` (a mixed column). | "What was total revenue by region in samples/sales_2025.csv?" · "Save revenue by region from samples/sales_2025.csv as an Excel file." · "Chart monthly revenue by product from samples/sales_2025.csv as a line chart." |
| `inventory.tsv` | Tab-separated stock for 24 products in 3 warehouses, with a two-line report title above the header (header on line 3). | "Which products in samples/inventory.tsv are below their reorder point?" · "Total stock value per warehouse in samples/inventory.tsv." |
| `payroll_2025.xlsx` | Three sheets. `Employees`: 48 people under a title block (header on row 3), with start dates and salaries in dollars. `Monthly`: headcount and payroll cost by department and month, in long format. `Notes`: how the numbers were derived. | "Chart monthly headcount by department as a stacked bar from samples/payroll_2025.xlsx." · "Who joined in 2025, per samples/payroll_2025.xlsx?" |
| `budget_legacy.xls` | Legacy Excel 97 workbook. `Budget`: budget vs actual per month, department, and line item (dates in the first column). `Assumptions`: a few key/value settings. | "Which department overspent most in samples/budget_legacy.xls?" · "Plot budget vs actual by month for Engineering from samples/budget_legacy.xls." |
| `board_report.docx` | A board report with a heading outline and four tables: revenue by quarter, headcount by office, an empty risk register (header only), and best sellers. | "Plot the second table in samples/board_report.docx and save it as a PDF." · "What tables are in samples/board_report.docx?" |
| `survey_export.csv` | 120 survey responses that are really an `.xlsx` workbook with a `.csv` name, as some export tools produce. Dates, 1-5 scores, a yes/no column, and comments with blanks. | "Summarise samples/survey_export.csv." · "Average satisfaction by channel in samples/survey_export.csv, as a bar chart." |
