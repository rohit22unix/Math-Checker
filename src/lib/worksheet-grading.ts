import { all, create, fraction } from "mathjs";

const math = create(all, { number: "Fraction" });

export type ExtractedProblem = {
  number: number;
  printed_expression: string;
  last_operation_before_answer?: string;
  written_final_answer?: string;
  student_final_answer?: string;
};

export type GradedProblem = {
  number: number;
  expression: string;
  studentAnswer: string;
  writtenAnswer: string;
  answerSource: "work" | "written" | "unclear";
  correctAnswer: string;
  status: "Correct" | "Incorrect" | "Unanswered" | "Unclear";
  note?: string;
};

export function parseExtractedProblems(raw: string): ExtractedProblem[] {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonMatch = fencedMatch?.[1]?.match(/\[[\s\S]*\]/) || raw.match(/\[[\s\S]*\]/);

  if (!jsonMatch) {
    return [];
  }

  const jsonText = jsonMatch[0];

  try {
    const parsed = JSON.parse(jsonText) as ExtractedProblem[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => typeof item?.number === "number")
      .map((item) => ({
        number: item.number,
        printed_expression: String(item.printed_expression || "").trim(),
        last_operation_before_answer: String(
          item.last_operation_before_answer || ""
        ).trim(),
        written_final_answer: String(
          item.written_final_answer || item.student_final_answer || ""
        ).trim(),
      }));
  } catch {
    return [];
  }
}

function normalizeExpression(expression: string): string {
  return expression
    .replace(/[÷∕]/g, "/")
    .replace(/[×xX]/g, "*")
    .replace(/−/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function formatFraction(value: unknown): string | null {
  try {
    const valueFraction = fraction(value as string | number);
    const text = valueFraction.toString();

    if (!text || text === "NaN") {
      return null;
    }

    return text.replace(/^(-?\d+)\/1$/, "$1");
  } catch {
    return null;
  }
}

function parseAnswerFraction(answer: string): string | null {
  const normalized = normalizeExpression(answer);

  if (!normalized || normalized.toLowerCase() === "unclear") {
    return null;
  }

  if (/^-?\d+$/.test(normalized)) {
    return formatFraction(fraction(Number(normalized), 1));
  }

  if (/^-?\d+\s*\/\s*\d+$/.test(normalized)) {
    return formatFraction(fraction(normalized.replace(/\s+/g, "")));
  }

  return null;
}

export function evaluateExpression(expression: string): string | null {
  const normalized = normalizeExpression(expression);

  if (!normalized) {
    return null;
  }

  try {
    return formatFraction(math.evaluate(normalized));
  } catch {
    return null;
  }
}

function inferStudentAnswer(problem: ExtractedProblem): {
  answer: string;
  writtenAnswer: string;
  source: GradedProblem["answerSource"];
  note?: string;
} {
  const writtenRaw =
    problem.written_final_answer || problem.student_final_answer || "";
  const writtenAnswer = parseAnswerFraction(writtenRaw) || writtenRaw.trim();
  const workExpression = problem.last_operation_before_answer || "";
  const workAnswer = workExpression
    ? evaluateExpression(workExpression)
    : null;

  if (workAnswer) {
    if (
      writtenAnswer &&
      writtenAnswer !== "unclear" &&
      writtenAnswer !== workAnswer
    ) {
      return {
        answer: workAnswer,
        writtenAnswer,
        source: "work",
        note: `Work steps imply ${workAnswer}; final written answer read as ${writtenAnswer}.`,
      };
    }

    return {
      answer: workAnswer,
      writtenAnswer: writtenAnswer || workAnswer,
      source: "work",
    };
  }

  if (writtenAnswer && writtenAnswer !== "unclear") {
    return {
      answer: writtenAnswer,
      writtenAnswer,
      source: "written",
    };
  }

  return {
    answer: "",
    writtenAnswer: writtenAnswer || "",
    source: "unclear",
  };
}

export function gradeProblems(problems: ExtractedProblem[]): GradedProblem[] {
  return problems.map((problem) => {
    const expression = normalizeExpression(problem.printed_expression);
    const inferred = inferStudentAnswer(problem);
    const correctAnswer = expression ? evaluateExpression(expression) : null;

    if (!expression || !correctAnswer) {
      return {
        number: problem.number,
        expression: problem.printed_expression || "Unclear",
        studentAnswer: inferred.answer || "Unclear",
        writtenAnswer: inferred.writtenAnswer || "Unclear",
        answerSource: inferred.source,
        correctAnswer: correctAnswer || "Unclear",
        status: "Unclear",
        note: inferred.note,
      };
    }

    if (!inferred.answer) {
      return {
        number: problem.number,
        expression: problem.printed_expression,
        studentAnswer: "Unanswered",
        writtenAnswer: inferred.writtenAnswer || "Unanswered",
        answerSource: inferred.source,
        correctAnswer,
        status: "Unanswered",
        note: inferred.note,
      };
    }

    const status =
      inferred.answer === correctAnswer ? "Correct" : "Incorrect";

    return {
      number: problem.number,
      expression: problem.printed_expression,
      studentAnswer: inferred.answer,
      writtenAnswer: inferred.writtenAnswer || inferred.answer,
      answerSource: inferred.source,
      correctAnswer,
      status,
      note: inferred.note,
    };
  });
}

export function formatGradedReport(problems: GradedProblem[]): string {
  const counts = {
    correct: 0,
    incorrect: 0,
    unanswered: 0,
    unclear: 0,
  };

  for (const problem of problems) {
    if (problem.status === "Correct") counts.correct += 1;
    if (problem.status === "Incorrect") counts.incorrect += 1;
    if (problem.status === "Unanswered") counts.unanswered += 1;
    if (problem.status === "Unclear") counts.unclear += 1;
  }

  const lines = [
    "Graded by Math-Checker (server-side)",
    `Summary: ${problems.length} visible, ${counts.correct} correct, ${counts.incorrect} incorrect, ${counts.unanswered} unanswered, ${counts.unclear} unclear.`,
  ];

  for (const problem of problems) {
    lines.push(
      `${problem.number}. ${problem.expression} | ${problem.studentAnswer} | ${problem.correctAnswer} | ${problem.status}`
    );

    if (problem.note) {
      lines.push(`   Note: ${problem.note}`);
    }
  }

  return lines.join("\n");
}

export function gradeWorksheetFromModelText(raw: string): string | null {
  const extracted = parseExtractedProblems(raw);

  if (!extracted.length) {
    return null;
  }

  return formatGradedReport(gradeProblems(extracted));
}

export function parseWorkSteps(
  raw: string
): Array<{ number: number; last_operation_before_answer: string }> {
  const jsonMatch =
    raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.match(/\[[\s\S]*\]/) ||
    raw.match(/\[[\s\S]*\]/);

  if (!jsonMatch) {
    return [];
  }

  const jsonText = jsonMatch[0];

  try {
    const parsed = JSON.parse(jsonText) as Array<{
      number?: number;
      last_operation_before_answer?: string;
    }>;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => typeof item?.number === "number")
      .map((item) => ({
        number: item.number as number,
        last_operation_before_answer: String(
          item.last_operation_before_answer || ""
        ).trim(),
      }))
      .filter((item) => item.last_operation_before_answer.length > 0);
  } catch {
    return [];
  }
}
export function mergeWorkSteps(
  problems: ExtractedProblem[],
  workSteps: Array<{ number: number; last_operation_before_answer: string }>
): ExtractedProblem[] {
  const workByNumber = new Map<number, string>();

  for (const step of workSteps) {
    workByNumber.set(step.number, step.last_operation_before_answer);
  }

  return problems.map((problem) => ({
    ...problem,
    last_operation_before_answer:
      problem.last_operation_before_answer ||
      workByNumber.get(problem.number) ||
      "",
  }));
}

export function problemsMissingWorkSteps(
  problems: ExtractedProblem[]
): ExtractedProblem[] {
  return problems.filter((problem) => !problem.last_operation_before_answer);
}
