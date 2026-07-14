import {
  hasSupabaseConfig,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/config";
import { formatDeadlineLabel } from "@/lib/carrymate/project-dates";

export type CreateTeamInput = {
  teamName: string;
  courseName: string;
  inviteCode?: string;
  deadlineLabel?: string;
  memberNames: string[];
  description?: string;
  startDate?: string;
  endDate?: string;
};

type SupabaseInsertError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

export type TeamRow = {
  id: string;
  team_name: string;
  course_name: string;
  deadline_label: string;
  member_names: string[];
  invite_code: string;
  created_at: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
};

type SaveTeamResult = {
  ok: boolean;
  message: string;
  team?: TeamRow;
};

type TeamQueryResult<T> = {
  ok: boolean;
  data?: T;
  message: string;
};

type UpdateTeamDetailsInput = {
  id: string;
  teamName?: string;
  courseName?: string;
  deadlineLabel?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
};

const INVITE_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDescription(value?: string) {
  return value?.trim() ?? "";
}

function normalizeStartDate(value?: string) {
  return value?.trim() || getTodayDateString();
}

function normalizeEndDate(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeDeadlineLabel(deadlineLabel?: string, endDate?: string) {
  const trimmed = deadlineLabel?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (endDate) {
    return formatDeadlineLabel(endDate);
  }

  return "";
}

export function normalizeInviteCode(inviteCode: string | null | undefined) {
  return inviteCode?.trim().toUpperCase() ?? "";
}

export function generateInviteCode() {
  const bytes = new Uint32Array(8);

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * INVITE_CODE_CHARSET.length);
    }
  }

  return Array.from(bytes, (value) =>
    INVITE_CODE_CHARSET[value % INVITE_CODE_CHARSET.length],
  ).join("");
}

async function parseErrorMessage(response: Response) {
  const fallbackMessage = await response.text();
  let detail = fallbackMessage;

  try {
    const parsed = JSON.parse(fallbackMessage) as SupabaseInsertError;
    detail = parsed.message ?? parsed.details ?? fallbackMessage;
  } catch {
    // Response may not be JSON.
  }

  return detail;
}

export async function saveTeamToSupabase(
  input: CreateTeamInput,
): Promise<SaveTeamResult> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. .env.local의 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const endDate = normalizeEndDate(input.endDate);
  const deadlineLabel = normalizeDeadlineLabel(input.deadlineLabel, endDate ?? undefined);
  const inviteCode = input.inviteCode?.trim() || generateInviteCode();

  const response = await fetch(`${supabaseUrl}/rest/v1/teams?select=*`, {
    method: "POST",
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${supabasePublishableKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      team_name: input.teamName,
      course_name: input.courseName,
      invite_code: inviteCode,
      deadline_label: deadlineLabel,
      member_names: input.memberNames,
      description: normalizeDescription(input.description),
      start_date: normalizeStartDate(input.startDate),
      end_date: endDate,
    }),
  });

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `Supabase 저장 실패: ${detail}`,
    };
  }

  const teams = (await response.json()) as TeamRow[];
  return {
    ok: true,
    message: "Supabase 연동이 완료되어 팀 정보가 저장되었습니다.",
    team: teams[0],
  };
}

export async function getTeamByInviteCode(
  inviteCode: string,
): Promise<TeamQueryResult<TeamRow | null>> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. .env.local의 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const normalizedInviteCode = normalizeInviteCode(inviteCode);

  if (!normalizedInviteCode) {
    return {
      ok: false,
      message: "초대 코드가 비어 있습니다.",
    };
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/teams?invite_code=eq.${encodeURIComponent(normalizedInviteCode)}&select=*&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
    },
  );

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `Supabase 팀 조회 실패: ${detail}`,
    };
  }

  const teams = (await response.json()) as TeamRow[];
  return {
    ok: true,
    data: teams[0] ?? null,
    message: teams[0] ? "초대 코드 팀 조회 성공" : "해당 초대 코드의 팀이 없습니다.",
  };
}

export async function getTeamById(
  teamId: string,
): Promise<TeamQueryResult<TeamRow | null>> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. .env.local의 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/teams?id=eq.${encodeURIComponent(teamId)}&select=*&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
    },
  );

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `Supabase 팀 조회 실패: ${detail}`,
    };
  }

  const teams = (await response.json()) as TeamRow[];
  return {
    ok: true,
    data: teams[0] ?? null,
    message: teams[0] ? "팀 조회 성공" : "해당 팀이 없습니다.",
  };
}

export async function updateTeamDetails(
  input: UpdateTeamDetailsInput,
): Promise<{
  ok: boolean;
  message: string;
  team?: TeamRow;
}> {
  if (!hasSupabaseConfig()) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. .env.local의 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const updates: Partial<TeamRow> = {};

  if (input.teamName !== undefined) {
    updates.team_name = input.teamName.trim();
  }
  if (input.courseName !== undefined) {
    updates.course_name = input.courseName.trim();
  }
  if (input.deadlineLabel !== undefined) {
    updates.deadline_label = input.deadlineLabel.trim();
  }
  if (input.description !== undefined) {
    updates.description = normalizeDescription(input.description);
  }
  if (input.startDate !== undefined) {
    updates.start_date = normalizeStartDate(input.startDate);
  }
  if (input.endDate !== undefined) {
    updates.end_date = normalizeEndDate(input.endDate);
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/teams?id=eq.${encodeURIComponent(input.id)}&select=*`,
    {
      method: "PATCH",
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(updates),
    },
  );

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `Supabase update 실패: ${detail}. 현재 teams 테이블 RLS의 UPDATE 정책이 없으면 요청이 거절될 수 있습니다.`,
    };
  }

  const teams = (await response.json()) as TeamRow[];
  return {
    ok: true,
    message: "팀 정보가 업데이트되었습니다.",
    team: teams[0],
  };
}
