import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  buildTeamAssistantContext,
  type TeamAssistantContext,
  type TeamAssistantMessage,
} from "@/lib/carrymate/assistant-context";
import { mapMeetingNoteRowToMeetingNote, mapMeetingRowsToConfirmedMeetings, mapTeamMemberRowsToTeamMembers, mapTeamRowToProject, mapTaskRowsToTasks } from "@/lib/mappers/carrymate";
import { mapTeamFileRecordsToFileItems } from "@/lib/mappers/files";
import { hasSupabaseConfig, hasSupabaseServiceRoleConfig, supabasePublishableKey, supabaseServiceRoleKey, supabaseUrl } from "@/lib/supabase/config";
import type { FileVersionRow, SharedFileRow, TeamFileRecord } from "@/lib/supabase/files";
import type { MeetingNoteRow, MeetingRow } from "@/lib/supabase/meetings";
import type { TaskRow } from "@/lib/supabase/tasks";
import type { TeamMemberRow } from "@/lib/supabase/team-members";
import type { TeamAvailabilityEntry } from "@/lib/supabase/availability";

export const runtime = "nodejs";

type TeamAssistantRequestBody = {
  teamId?: string;
  messages?: TeamAssistantMessage[];
  context?: unknown;
};

type GeminiAction = {
  type: "open_tasks" | "open_schedule" | "open_meeting" | "open_files" | "none";
  targetId: string | null;
  label: string;
};

type GeminiPayload = {
  answer?: string;
  suggestedActions?: GeminiAction[];
  content?: string;
  text?: string;
};

function parseAuthorization(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authorization.slice(7).trim();
}

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stripCodeFences(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
}

function isGeminiAction(value: unknown): value is GeminiAction {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.type === "open_tasks" ||
      record.type === "open_schedule" ||
      record.type === "open_meeting" ||
      record.type === "open_files" ||
      record.type === "none") &&
    typeof record.label === "string"
  );
}

function parseGeminiResponse(rawText: string) {
  const cleaned = stripCodeFences(rawText);

  try {
    const parsed = JSON.parse(cleaned) as GeminiPayload;
    const answer = normalizeText(parsed.answer ?? parsed.content ?? parsed.text, 2000);
    const suggestedActions = Array.isArray(parsed.suggestedActions)
      ? parsed.suggestedActions.filter(isGeminiAction).slice(0, 3).map((action) => ({
          type: action.type,
          targetId: typeof action.targetId === "string" && action.targetId.trim() ? action.targetId.trim() : null,
          label: normalizeText(action.label, 60),
        }))
      : [];

    if (answer) {
      return {
        answer,
        suggestedActions,
      };
    }
  } catch {
    // fallback to plain text
  }

  return {
    answer: normalizeText(rawText, 2000) || "현재 저장된 데이터에서는 확인할 수 없습니다.",
    suggestedActions: [] as GeminiAction[],
  };
}

async function parseErrorMessage(response: Response) {
  const fallbackMessage = await response.text();

  try {
    const parsed = JSON.parse(fallbackMessage) as { message?: string; details?: string };
    return parsed.message ?? parsed.details ?? fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

async function getAuthorizedUser(request: NextRequest, teamId: string) {
  const accessToken = parseAuthorization(request);
  if (!accessToken) {
    return { ok: false as const, status: 401, message: "인증 토큰이 없습니다." };
  }

  const authClient = createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return {
      ok: false as const,
      status: 401,
      message: userError?.message ?? "사용자 인증에 실패했습니다.",
    };
  }

  const adminClient = getAdminClient();
  const { data: memberRow, error: memberError } = await adminClient
    .from("team_members")
    .select("id,team_id,profile_id,name,role,skill_tag,is_leader,status,joined_at")
    .eq("team_id", teamId)
    .eq("profile_id", userData.user.id)
    .maybeSingle();

  if (memberError) {
    return {
      ok: false as const,
      status: 500,
      message: memberError.message,
    };
  }

  if (!memberRow) {
    return {
      ok: false as const,
      status: 403,
      message: "현재 팀 멤버십이 확인되지 않습니다.",
    };
  }

  return {
    ok: true as const,
    userId: userData.user.id,
    accessToken,
  };
}

async function loadTeamAssistantContext(teamId: string) {
  const adminClient = getAdminClient();

  const [teamResult, membersResult, tasksResult, meetingsResult, notesResult, filesResult] =
    await Promise.all([
      adminClient
        .from("teams")
        .select("id,team_name,course_name,deadline_label,member_names,invite_code,created_at,description,start_date,end_date")
        .eq("id", teamId)
        .maybeSingle(),
      adminClient
        .from("team_members")
        .select("id,team_id,profile_id,name,role,skill_tag,is_leader,status,joined_at")
        .eq("team_id", teamId)
        .order("joined_at", { ascending: true }),
      adminClient
        .from("tasks")
        .select("id,team_id,title,description,assignee_id,status,priority,due_at,ai_suggested_role,completed_at,created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false })
        .limit(30),
      adminClient
        .from("meetings")
        .select("id,team_id,title,starts_at,ends_at,created_by,created_at")
        .eq("team_id", teamId)
        .order("starts_at", { ascending: false })
        .limit(10),
      adminClient
        .from("meeting_notes")
        .select("id,team_id,meeting_id,title,content,ai_summary,ai_decisions,ai_action_items,created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false })
        .limit(5),
      adminClient
        .from("shared_files")
        .select("id,team_id,name,category,uploaded_by,latest_version_id,created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (teamResult.error || !teamResult.data) {
    return {
      ok: false as const,
      message: teamResult.error?.message ?? "팀 정보를 불러오지 못했습니다.",
    };
  }

  const memberRows = (membersResult.data ?? []) as TeamMemberRow[];
  const taskRows = (tasksResult.data ?? []) as TaskRow[];
  const meetingRows = (meetingsResult.data ?? []) as MeetingRow[];
  const noteRows = (notesResult.data ?? []) as MeetingNoteRow[];
  const sharedFileRows = (filesResult.data ?? []) as SharedFileRow[];

  const latestVersionIds = sharedFileRows
    .map((row) => row.latest_version_id)
    .filter((value): value is string => Boolean(value));

  const versionRowsResult =
    latestVersionIds.length > 0
      ? await adminClient
          .from("file_versions")
          .select("id,shared_file_id,storage_path,file_name,mime_type,file_size,uploaded_by,created_at")
          .in("id", latestVersionIds)
      : { data: [] as FileVersionRow[], error: null as { message: string } | null };

  const availabilityRowsResult = await adminClient
    .from("availability_slots")
    .select("member_id,day_of_week,time_slot,created_at")
    .in("member_id", memberRows.map((row) => row.id))
    .order("day_of_week", { ascending: true })
    .order("time_slot", { ascending: true });

  const memberById = new Map(memberRows.map((row) => [row.id, row.name]));
  const versionById = new Map(
    ((versionRowsResult.data ?? []) as FileVersionRow[]).map((row) => [row.id, row]),
  );

  const teamFileRecords: TeamFileRecord[] = sharedFileRows.map((sharedFile) => ({
    sharedFile,
    latestVersion: sharedFile.latest_version_id
      ? versionById.get(sharedFile.latest_version_id) ?? null
      : null,
  }));

  const availabilityEntries: TeamAvailabilityEntry[] = (availabilityRowsResult.data ?? [])
    .map((row) => {
      const memberName = memberById.get(row.member_id);
      if (!memberName) {
        return null;
      }

      return {
        memberId: row.member_id,
        memberName,
        day: row.day_of_week,
        time: row.time_slot,
      };
    })
    .filter((item): item is TeamAvailabilityEntry => item !== null);

  const project = mapTeamRowToProject(teamResult.data);
  const members = mapTeamMemberRowsToTeamMembers(memberRows);
  const tasks = mapTaskRowsToTasks(taskRows);
  const meetings = mapMeetingRowsToConfirmedMeetings(meetingRows);
  const meetingNotes = noteRows.map(mapMeetingNoteRowToMeetingNote);
  const files = mapTeamFileRecordsToFileItems(teamFileRecords, members);

  const meetingsWithNotes = meetings.map((meeting) => {
    const note = meetingNotes.find((item) => item.meetingId === meeting.id);
    if (!note) {
      return meeting;
    }

    return {
      ...meeting,
      aiSummary: note.aiSummary ?? meeting.aiSummary,
      aiDecisions: note.aiDecisions.length > 0 ? note.aiDecisions : meeting.aiDecisions,
      aiUnresolvedItems:
        note.aiUnresolvedItems.length > 0 ? note.aiUnresolvedItems : meeting.aiUnresolvedItems,
      aiActionItems: note.aiActionItems.length > 0 ? note.aiActionItems : meeting.aiActionItems,
    };
  });

  return {
    ok: true as const,
    context: buildTeamAssistantContext({
      project,
      members,
      tasks,
      meetings: meetingsWithNotes,
      teamAvailability: availabilityEntries,
      files,
    }),
  };
}

function buildSystemInstruction() {
  return [
    "너는 CarryMate AI 챗봇이다.",
    "반드시 제공된 팀 데이터와 최근 대화만 근거로 답변한다.",
    "데이터에 없는 내용은 만들지 않는다.",
    '확인할 수 없으면 "현재 저장된 데이터에서는 확인할 수 없습니다"라고 답한다.',
    "날짜, 상태, 담당자 정보는 정확히 구분한다.",
    "추천은 추천이라고 명시한다.",
    "실제 DB 변경을 했다고 말하지 않는다.",
    "민감한 개인정보를 불필요하게 반복하지 않는다.",
    "답변은 한국어로 간결하고 이해하기 쉽게 작성한다.",
    "사용자가 변경 작업을 요청하면 직접 실행하지 말고 관련 화면으로 이동하는 제안만 한다.",
    "응답 형식은 JSON 객체다.",
    '형식: {"answer":"...","suggestedActions":[{"type":"open_tasks|open_schedule|open_meeting|open_files|none","targetId":null,"label":"..."}]}',
    "suggestedActions는 최대 3개로 제한한다.",
    "질문이 모호하면 현재 데이터 범위 안에서 짧게 되묻는다.",
  ].join("\n");
}

function buildConversationContext(rawContext: TeamAssistantContext) {
  return JSON.stringify(
    rawContext,
    null,
    2,
  );
}

function buildConversationPayload(messages: TeamAssistantMessage[], contextText: string) {
  const limitedMessages = messages.slice(-12);

  return [
    {
      role: "user" as const,
      parts: [
        {
          text: [
            "현재 팀 데이터는 아래와 같다.",
            contextText,
            "이 데이터와 최근 대화만 근거로 답변해라.",
          ].join("\n\n"),
        },
      ],
    },
    ...limitedMessages.map((message) => ({
      role: message.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: message.content }],
    })),
  ];
}

async function askGemini(input: {
  contextText: string;
  messages: TeamAssistantMessage[];
}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return {
      ok: false as const,
      status: 500,
      message: "GEMINI_API_KEY가 설정되지 않았습니다.",
    };
  }

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: buildSystemInstruction(),
            },
          ],
        },
        contents: buildConversationPayload(input.messages, input.contextText),
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    const message = await parseErrorMessage(response);
    return {
      ok: false as const,
      status: response.status === 429 ? 429 : 500,
      message,
    };
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";

  return {
    ok: true as const,
    text,
  };
}

export async function POST(request: NextRequest) {
  if (!hasSupabaseConfig() || !hasSupabaseServiceRoleConfig()) {
    return NextResponse.json(
      {
        error:
          "Supabase 설정이 부족합니다. NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY를 확인해 주세요.",
      },
      { status: 500 },
    );
  }

  let body: TeamAssistantRequestBody;
  try {
    body = (await request.json()) as TeamAssistantRequestBody;
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽지 못했습니다." }, { status: 400 });
  }

  const teamId = body.teamId?.trim() ?? "";
  if (!teamId) {
    return NextResponse.json({ error: "teamId가 없습니다." }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const question = lastUserMessage?.content?.trim() ?? "";

  if (!question) {
    return NextResponse.json({ error: "질문이 없습니다." }, { status: 400 });
  }

  if (question.length > 500) {
    return NextResponse.json({ error: "질문이 너무 깁니다." }, { status: 400 });
  }

  const authResult = await getAuthorizedUser(request, teamId);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.message }, { status: authResult.status });
  }

  const contextResult = await loadTeamAssistantContext(teamId);
  if (!contextResult.ok) {
    return NextResponse.json({ error: contextResult.message }, { status: 500 });
  }

  const geminiResult = await askGemini({
    contextText: buildConversationContext(contextResult.context),
    messages,
  });

  if (!geminiResult.ok) {
    return NextResponse.json(
      {
        error: "AI 답변을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: geminiResult.status },
    );
  }

  const parsed = parseGeminiResponse(geminiResult.text);
  return NextResponse.json({
    answer: parsed.answer,
    suggestedActions: parsed.suggestedActions,
  });
}
