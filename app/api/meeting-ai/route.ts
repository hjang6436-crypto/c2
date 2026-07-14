import { NextResponse } from "next/server";

type MeetingAiRequest = {
  meetingId?: string;
  title?: string;
  content?: string;
  members?: string[];
};

type MeetingAiActionItem = {
  title: string;
  assigneeName: string;
  priority: "high" | "medium" | "low";
  dueDateOffsetDays: number;
};

type MeetingAiResponse = {
  summary: string;
  decisions: string[];
  unresolvedItems: string[];
  actionItems: MeetingAiActionItem[];
};

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";

function buildPrompt(
  input: Required<Pick<MeetingAiRequest, "title" | "content">> & {
    members: string[];
  },
) {
  return [
    "당신은 대학생 팀 프로젝트 회의 요약 도우미다.",
    "반드시 JSON만 반환하라.",
    "summary는 2~4문장 한국어 요약이다.",
    "decisions는 이미 결정된 사항 문자열 배열이다.",
    "unresolvedItems는 아직 미결정인 사항 문자열 배열이다.",
    "actionItems는 title, assigneeName, priority, dueDateOffsetDays를 가진 배열이다.",
    "assigneeName은 가능하면 실제 참여자 이름 중 하나를 사용하고, 불명확하면 빈 문자열을 사용하라.",
    "priority는 high, medium, low 중 하나다.",
    "dueDateOffsetDays는 오늘 기준 정수 일수이며, 불명확하면 3을 사용하라.",
    `회의 제목: ${input.title}`,
    `참여자 후보: ${input.members.join(", ") || "없음"}`,
    "회의 대화:",
    input.content,
  ].join("\n");
}

function extractTextCandidates(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractTextCandidates);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directText = typeof record.text === "string" ? [record.text] : [];

  return [...directText, ...Object.values(record).flatMap(extractTextCandidates)];
}

function tryParseJsonBlock(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

function normalizeAiPayload(value: unknown): MeetingAiResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const decisions = Array.isArray(record.decisions)
    ? record.decisions
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const unresolvedItems = Array.isArray(record.unresolvedItems)
    ? record.unresolvedItems
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const actionItems = Array.isArray(record.actionItems)
    ? record.actionItems
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }

          const actionRecord = item as Record<string, unknown>;
          const title =
            typeof actionRecord.title === "string" ? actionRecord.title.trim() : "";
          if (!title) {
            return null;
          }

          const assigneeName =
            typeof actionRecord.assigneeName === "string"
              ? actionRecord.assigneeName.trim()
              : "";
          const priority =
            actionRecord.priority === "high" ||
            actionRecord.priority === "medium" ||
            actionRecord.priority === "low"
              ? actionRecord.priority
              : "medium";
          const dueDateOffsetDays =
            typeof actionRecord.dueDateOffsetDays === "number" &&
            Number.isFinite(actionRecord.dueDateOffsetDays)
              ? Math.max(0, Math.round(actionRecord.dueDateOffsetDays))
              : 3;

          return {
            title,
            assigneeName,
            priority,
            dueDateOffsetDays,
          };
        })
        .filter((item): item is MeetingAiActionItem => Boolean(item))
    : [];

  if (!summary) {
    return null;
  }

  return {
    summary,
    decisions,
    unresolvedItems,
    actionItems,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  let body: MeetingAiRequest;

  try {
    body = (await request.json()) as MeetingAiRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const meetingId = body.meetingId?.trim();
  const title = body.title?.trim();
  const content = body.content?.trim();
  const members = Array.isArray(body.members)
    ? body.members
        .filter((member): member is string => typeof member === "string")
        .map((member) => member.trim())
        .filter(Boolean)
    : [];

  if (!meetingId || !title || !content) {
    return NextResponse.json(
      { error: "meetingId, title, content는 필수입니다." },
      { status: 400 },
    );
  }

  const responseFormat = {
    type: "text",
    mime_type: "application/json",
    schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        decisions: {
          type: "array",
          items: { type: "string" },
        },
        unresolvedItems: {
          type: "array",
          items: { type: "string" },
        },
        actionItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              assigneeName: { type: "string" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              dueDateOffsetDays: { type: "integer" },
            },
            required: ["title", "assigneeName", "priority", "dueDateOffsetDays"],
          },
        },
      },
      required: ["summary", "decisions", "unresolvedItems", "actionItems"],
    },
  };

  let geminiResponse: Response;

  try {
    geminiResponse = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.5-flash",
        input: buildPrompt({ title, content, members }),
        response_format: responseFormat,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Gemini API 호출 중 네트워크 오류가 발생했습니다." },
      { status: 502 },
    );
  }

  if (!geminiResponse.ok) {
    const detail = await geminiResponse.text();
    const status =
      geminiResponse.status === 429
        ? 429
        : geminiResponse.status >= 500
          ? 502
          : 500;
    const error =
      geminiResponse.status === 429
        ? "Gemini API rate limit에 도달했습니다."
        : `Gemini API 오류: ${detail}`;

    return NextResponse.json({ error }, { status });
  }

  let rawResponse: unknown;

  try {
    rawResponse = (await geminiResponse.json()) as unknown;
  } catch {
    return NextResponse.json(
      { error: "Gemini 응답을 JSON으로 읽지 못했습니다." },
      { status: 502 },
    );
  }

  const textCandidates = extractTextCandidates(rawResponse);
  const parsedPayload = textCandidates
    .map(tryParseJsonBlock)
    .map(normalizeAiPayload)
    .find((item) => item !== null);

  if (!parsedPayload) {
    return NextResponse.json(
      { error: "Gemini 응답이 비었거나 JSON 파싱에 실패했습니다." },
      { status: 502 },
    );
  }

  return NextResponse.json(parsedPayload);
}
