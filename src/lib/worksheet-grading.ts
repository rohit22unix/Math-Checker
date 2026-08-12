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

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as ExtractedProblem[] | ExtractedProblem;

      if (Array.isArray(parsed)) {
        return normalizeExtractedProblems(parsed);
      }

      if (parsed && typeof parsed === "object") {
        return normalizeExtractedProblems([parsed]);
      }
    } catch {
      // Fall through to single-object parsing.
    }
  }

  const objectMatch =
    fencedMatch?.[1]?.match(/\{[\s\S]*\}/) || raw.match(/\{[\s\S]*\}/);

  if (!objectMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(objectMatch[0]) as ExtractedProblem;

    if (parsed && typeof parsed === "object") {
      return normalizeExtractedProblems([parsed]);
    }
  } catch {
    return [];
  }

  return [];
}

function normalizeExtractedProblems(items: ExtractedProblem[]): ExtractedProblem[] {
  return items
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
}

export function mergeExtractedProblems(
  problems: ExtractedProblem[]
): ExtractedProblem[] {
  const byNumber = new Map<number, ExtractedProblem>();

  for (const problem of problems) {
    const existing = byNumber.get(problem.number);

    if (!existing) {
      byNumber.set(problem.number, problem);
      continue;
    }

    byNumber.set(problem.number, {
      number: problem.number,
      printed_expression:
        existing.printed_expression || problem.printed_expression,
      last_operation_before_answer:
        existing.last_operation_before_answer ||
        problem.last_operation_before_answer,
      written_final_answer:
        existing.written_final_answer || problem.written_final_answer,
    });
  }

  return Array.from(byNumber.values()).sort((left, right) => left.number - right.number);
}

function latexToPlainMath(input: string): string {
  let text = input;

  for (let index = 0; index < 8; index += 1) {
    const next = text.replace(
      /\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,
      "$1/$2"
    );

    if (next === text) {
      break;
    }

    text = next;
  }

  return text
    .replace(/\\div/g, "/")
    .replace(/\\times/g, "*")
    .replace(/\\cdot/g, "*")
    .replace(/\\left\s*\(/g, "(")
    .replace(/\\right\s*\)/g, ")")
    .replace(/[{}]/g, "")
    .replace(/[÷∕]/g, "/")
    .replace(/[×xX]/g, "*")
    .replace(/−/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExpression(expression: string): string {
  return latexToPlainMath(expression);
}

function formatFraction(value: unknown): string | null {
  try {
    const valueFraction = fraction(value as string | number);
    const typed = valueFraction as unknown as {
      s: bigint;
      n: bigint;
      d: bigint;
    };
    const sign = Number(typed.s) < 0 ? "-" : "";
    const numerator = Math.abs(Number(typed.n));
    const denominator = Number(typed.d);

    if (denominator === 1) {
      return `${sign}${numerator}`;
    }

    return `${sign}${numerator}/${denominator}`;
  } catch {
    return null;
  }
}

function parseRepeatingDecimal(answer: string): string | null {
  const match = answer.match(/^(-?\d+(?:\.\d+)?)\((\d+)\)$/);

  if (!match) {
    return null;
  }

  const [, wholePart, repeatDigits] = match;
  const decimalPrefix = wholePart.includes(".")
    ? wholePart
    : `${wholePart}.${repeatDigits}`;
  const approximate = Number(`${decimalPrefix}${repeatDigits.slice(0, 2)}`);

  if (Number.isNaN(approximate)) {
    return null;
  }

  return formatFraction(fraction(approximate));
}

function parseAnswerFraction(answer: string): string | null {
  const normalized = normalizeExpression(answer);

  if (!normalized || normalized.toLowerCase() === "unclear") {
    return null;
  }

  if (/^-?\d+\s*\/\s*\d+$/.test(normalized)) {
    return formatFraction(fraction(normalized.replace(/\s+/g, "")));
  }

  if (/^-?\d+$/.test(normalized)) {
    return formatFraction(fraction(Number(normalized), 1));
  }

  if (/^-?\d*\.\d+\(\d+\)$/.test(normalized)) {
    return parseRepeatingDecimal(normalized);
  }

  if (/^-?\d*\.\d+$/.test(normalized)) {
    return formatFraction(fraction(parseFloat(normalized)));
  }

  return null;
}

function fractionsEqual(left: string, right: string): boolean {
  try {
    return Boolean(math.equal(fraction(left), fraction(right)));
  } catch {
    return left === right;
  }
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
  const writtenParsed = parseAnswerFraction(writtenRaw);
  const writtenAnswer = writtenParsed || writtenRaw.trim();
  const workExpression = normalizeExpression(
    problem.last_operation_before_answer || ""
  );
  const workAnswer = workExpression ? evaluateExpression(workExpression) : null;

  if (workAnswer) {
    if (
      writtenParsed &&
      writtenParsed !== workAnswer &&
      !fractionsEqual(writtenParsed, workAnswer)
    ) {
      return {
        answer: workAnswer,
        writtenAnswer: writtenParsed,
        source: "work",
        note: `Work steps imply ${workAnswer}; final written answer read as ${writtenParsed}.`,
      };
    }

    return {
      answer: workAnswer,
      writtenAnswer: writtenParsed || workAnswer,
      source: "work",
    };
  }

  if (writtenParsed) {
    return {
      answer: writtenParsed,
      writtenAnswer: writtenParsed,
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
    const displayExpression =
      expression || latexToPlainMath(problem.printed_expression) || "Unclear";

    if (!correctAnswer) {
      return {
        number: problem.number,
        expression: displayExpression,
        studentAnswer: inferred.answer || "Unclear",
        writtenAnswer: inferred.writtenAnswer || "Unclear",
        answerSource: inferred.source,
        correctAnswer: "Unclear",
        status: "Unclear",
        note: inferred.note,
      };
    }

    if (!inferred.answer) {
      return {
        number: problem.number,
        expression: displayExpression,
        studentAnswer: "Unanswered",
        writtenAnswer: inferred.writtenAnswer || "Unanswered",
        answerSource: inferred.source,
        correctAnswer,
        status: "Unanswered",
        note: inferred.note,
      };
    }

    const status = fractionsEqual(inferred.answer, correctAnswer)
      ? "Correct"
      : "Incorrect";

    return {
      number: problem.number,
      expression: displayExpression,
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

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
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

export function problemsNeedingWorkStepPass(
  problems: ExtractedProblem[]
): ExtractedProblem[] {
  const graded = gradeProblems(problems);

  return problems.filter((problem, index) => {
    const result = graded[index];

    return (
      !problem.last_operation_before_answer ||
      result?.status === "Unclear" ||
      result?.correctAnswer === "Unclear"
    );
  });
}
