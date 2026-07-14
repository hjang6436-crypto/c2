import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  hasSupabaseConfig,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/config";

export type MeetingRow = {
  id: string;
  team_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type MeetingMessageRow = {
  id: string;
  meeting_id: string;
  member_id: string | null;
  sender_name: string;
  message: string;
  created_at: string;
};

export type MeetingNoteRow = {
  id: string;
  team_id: string;
  meeting_id: string | null;
  title: string;
  content: string;
  ai_summary: string | null;
  ai_decisions: unknown;
  ai_action_items: unknown;
  created_at: string;
};

export type CreateMeetingInput = {
  teamId: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  createdBy?: string | null;
};

export type CreateMeetingMessageInput = {
  meetingId: string;
  memberId?: string | null;
  senderName: string;
  message: string;
};

export type UpdateMeetingMessageInput = {
  message: string;
};

export type CreateMeetingNoteInput = {
  teamId: string;
  meetingId?: string | null;
  title: string;
  content: string;
  aiSummary?: string | null;
  aiDecisions?: unknown;
  aiActionItems?: unknown;
};

type SupabaseErrorPayload = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

type MeetingResult<T> = {
  ok: boolean;
  data?: T;
  message: string;
};

function ensureSupabaseConfig() {
  if (!hasSupabaseConfig()) {
    return {
      ok: false as const,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  return null;
}

function getHeaders() {
  return {
    apikey: supabasePublishableKey,
    Authorization: `Bearer ${supabasePublishableKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

async function parseErrorMessage(response: Response) {
  const fallbackMessage = await response.text();
  let detail = fallbackMessage;

  try {
    const parsed = JSON.parse(fallbackMessage) as SupabaseErrorPayload;
    detail = parsed.message ?? parsed.details ?? fallbackMessage;
  } catch {
    // Keep raw body when response is not JSON.
  }

  return detail;
}

export async function createMeeting(
  input: CreateMeetingInput,
): Promise<MeetingResult<MeetingRow>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const payload = {
    team_id: input.teamId,
    title: input.title.trim(),
    starts_at: input.startsAt,
    ends_at: input.endsAt ?? null,
    created_by: input.createdBy ?? null,
  };

  console.log("[createMeeting] payload", payload);

  const response = await fetch(`${supabaseUrl}/rest/v1/meetings?select=*`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const fallbackMessage = await response.text();
    let parsedError: SupabaseErrorPayload = {};

    try {
      parsedError = JSON.parse(fallbackMessage) as SupabaseErrorPayload;
    } catch {
      parsedError = {
        message: fallbackMessage,
      };
    }

    console.log("[createMeeting] error.message", parsedError.message ?? "");
    console.log("[createMeeting] error.details", parsedError.details ?? "");
    console.log("[createMeeting] error.code", parsedError.code ?? "");
    console.log("[createMeeting] error.hint", parsedError.hint ?? "");

    const detail = parsedError.message ?? parsedError.details ?? fallbackMessage;
    return {
      ok: false,
      message: `회의 생성 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as MeetingRow[];
  return {
    ok: true,
    data: rows[0],
    message: "회의 생성 성공",
  };
}

export async function getMeetingsByTeam(
  teamId: string,
): Promise<MeetingResult<MeetingRow[]>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/meetings?team_id=eq.${encodeURIComponent(teamId)}&select=*&order=starts_at.desc`,
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
      message: `회의 조회 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as MeetingRow[];
  return {
    ok: true,
    data: rows,
    message: "회의 조회 성공",
  };
}

export async function getMeetingById(
  meetingId: string,
): Promise<MeetingResult<MeetingRow | null>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/meetings?id=eq.${encodeURIComponent(meetingId)}&select=*&limit=1`,
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
      message: `회의 단건 조회 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as MeetingRow[];
  return {
    ok: true,
    data: rows[0] ?? null,
    message: rows[0] ? "회의 단건 조회 성공" : "회의를 찾지 못했습니다.",
  };
}

export async function endMeeting(
  meetingId: string,
  endedAt?: string,
): Promise<MeetingResult<MeetingRow>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/meetings?id=eq.${encodeURIComponent(meetingId)}&select=*`,
    {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify({
        ends_at: endedAt ?? new Date().toISOString(),
      }),
    },
  );

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `회의 종료 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as MeetingRow[];
  return {
    ok: true,
    data: rows[0],
    message: "회의 종료 성공",
  };
}

export async function getMeetingMessages(
  meetingId: string,
): Promise<MeetingResult<MeetingMessageRow[]>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/meeting_messages?meeting_id=eq.${encodeURIComponent(meetingId)}&select=*&order=created_at.asc`,
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
      message: `회의 메시지 조회 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as MeetingMessageRow[];
  return {
    ok: true,
    data: rows,
    message: "회의 메시지 조회 성공",
  };
}

export async function createMeetingMessage(
  input: CreateMeetingMessageInput,
): Promise<MeetingResult<MeetingMessageRow>> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const { data, error } = await supabase
    .from("meeting_messages")
    .insert({
      meeting_id: input.meetingId,
      member_id: input.memberId ?? null,
      sender_name: input.senderName.trim(),
      message: input.message.trim(),
    })
    .select("*")
    .single();

  if (error) {
    return {
      ok: false,
      message: `회의 메시지 저장 실패: ${error.message}`,
    };
  }

  return {
    ok: true,
    data: data as MeetingMessageRow,
    message: "회의 메시지 저장 성공",
  };
}

export async function getMeetingNoteByMeetingId(
  meetingId: string,
): Promise<MeetingResult<MeetingNoteRow | null>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/meeting_notes?meeting_id=eq.${encodeURIComponent(meetingId)}&select=*&order=created_at.desc&limit=1`,
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
      message: `회의 노트 조회 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as MeetingNoteRow[];
  return {
    ok: true,
    data: rows[0] ?? null,
    message: rows[0] ? "회의 노트 조회 성공" : "회의 노트가 없습니다.",
  };
}

export async function getMeetingNotesByTeam(
  teamId: string,
): Promise<MeetingResult<MeetingNoteRow[]>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/meeting_notes?team_id=eq.${encodeURIComponent(teamId)}&select=*&order=created_at.desc`,
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
      message: `회의 노트 목록 조회 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as MeetingNoteRow[];
  return {
    ok: true,
    data: rows,
    message: "회의 노트 목록 조회 성공",
  };
}

export async function createMeetingNote(
  input: CreateMeetingNoteInput,
): Promise<MeetingResult<MeetingNoteRow>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  if (input.meetingId) {
    const existingNoteResult = await getMeetingNoteByMeetingId(input.meetingId);

    if (!existingNoteResult.ok) {
      return {
        ok: false,
        message: existingNoteResult.message,
      };
    }

    if (existingNoteResult.data) {
      const updateResponse = await fetch(
        `${supabaseUrl}/rest/v1/meeting_notes?id=eq.${encodeURIComponent(existingNoteResult.data.id)}&select=*`,
        {
          method: "PATCH",
          headers: getHeaders(),
          body: JSON.stringify({
            title: input.title.trim(),
            content: input.content,
            ai_summary: input.aiSummary ?? null,
            ai_decisions: input.aiDecisions ?? [],
            ai_action_items: input.aiActionItems ?? [],
          }),
        },
      );

      if (!updateResponse.ok) {
        const detail = await parseErrorMessage(updateResponse);
        return {
          ok: false,
          message: `회의 노트 수정 실패: ${detail}`,
        };
      }

      const updatedRows = (await updateResponse.json()) as MeetingNoteRow[];
      return {
        ok: true,
        data: updatedRows[0],
        message: "회의 노트 수정 성공",
      };
    }
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/meeting_notes?select=*`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      team_id: input.teamId,
      meeting_id: input.meetingId ?? null,
      title: input.title.trim(),
      content: input.content,
      ai_summary: input.aiSummary ?? null,
      ai_decisions: input.aiDecisions ?? [],
      ai_action_items: input.aiActionItems ?? [],
    }),
  });

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `회의 노트 저장 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as MeetingNoteRow[];
  return {
    ok: true,
    data: rows[0],
    message: "회의 노트 저장 성공",
  };
}

export async function updateMeetingMessage(
  messageId: string,
  input: UpdateMeetingMessageInput,
): Promise<MeetingResult<MeetingMessageRow>> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const { data, error } = await supabase
    .from("meeting_messages")
    .update({
      message: input.message.trim(),
    })
    .eq("id", messageId)
    .select("*")
    .single();

  if (error) {
    return {
      ok: false,
      message: `회의 메시지 수정 실패: ${error.message}`,
    };
  }

  return {
    ok: true,
    data: data as MeetingMessageRow,
    message: "회의 메시지 수정 성공",
  };
}

export async function deleteMeetingMessage(
  messageId: string,
): Promise<MeetingResult<null>> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const { error } = await supabase.from("meeting_messages").delete().eq("id", messageId);

  if (error) {
    return {
      ok: false,
      message: `회의 메시지 삭제 실패: ${error.message}`,
    };
  }

  return {
    ok: true,
    data: null,
    message: "회의 메시지 삭제 성공",
  };
}
