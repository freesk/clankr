// samples/survey_export.csv: customer survey responses saved as an .xlsx workbook
// but named .csv, the way some export tools do. Inspection must detect the real
// format. Includes a boolean column and free-text comments with blanks.

import { dateCell, type WorkbookSheet } from "../generators/spreadsheet.ts";
import { seededRandom } from "../seeded-random.ts";

export interface SurveyResponse {
  respondentId: number;
  /** ISO date. */
  submittedOn: string;
  channel: string;
  satisfaction: number;
  wouldRecommend: boolean;
  comment: string | null;
}

export const surveyResponseCount = 120;
export const surveyChannels = ["Web", "Store", "Phone"] as const;

const comments = [
  "Fast delivery.",
  "The lantern strap broke after a week.",
  "Helpful staff in store.",
  "Would like more colours.",
  "Checkout was confusing.",
];

export function surveyResponses(): SurveyResponse[] {
  const random = seededRandom(77);
  const responses: SurveyResponse[] = [];
  for (let index = 0; index < surveyResponseCount; index++) {
    const satisfaction = random.integer(1, 5);
    const day = 1 + Math.floor((index * 30) / surveyResponseCount);
    responses.push({
      respondentId: 5_001 + index,
      submittedOn: `2025-11-${String(day).padStart(2, "0")}`,
      channel: random.pick(surveyChannels),
      satisfaction,
      wouldRecommend: satisfaction >= 4,
      // The first response always has a comment: DuckDB's Excel reader types a column from
      // its first cells, and a column that starts empty is read as numbers.
      comment: index === 0 || random.chance(0.4) ? random.pick(comments) : null,
    });
  }
  return responses;
}

export function surveySheets(): WorkbookSheet[] {
  return [
    {
      name: "Responses",
      rows: [
        ["respondent_id", "submitted_on", "channel", "satisfaction", "would_recommend", "comment"],
        ...surveyResponses().map((response) => [
          response.respondentId,
          dateCell(response.submittedOn),
          response.channel,
          response.satisfaction,
          response.wouldRecommend,
          response.comment,
        ]),
      ],
    },
  ];
}
