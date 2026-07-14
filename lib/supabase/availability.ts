import {
  hasSupabaseConfig,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/config";
import { getTeamMembersByTeam } from "@/lib/supabase/team-members";

export type AvailabilitySlotRow = {
  id: string;
  member_id: string;
  day_of_week: number;
  time_slot: string;
  created_at: string;
};

export type AvailabilitySlotInput = {
  dayOfWeek: number;
  timeSlot: string;
};

export type TeamAvailabilityEntry = {
  memberId: string;
  memberName: string;
  day: number;
  time: string;
};

type AvailabilityResult<T> = {
  ok: boolean;
  data?: T;
  message: string;
};

type SupabaseErrorPayload = {
  message?: string;
  details?: string;
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
    // Keep raw text when response body is not JSON.
  }

  return detail;
}

export function normalizeAvailabilityTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return "";
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return "";
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeAvailabilitySlots(slots: AvailabilitySlotInput[]) {
  const seen = new Set<string>();

  return slots
    .map((slot) => ({
      dayOfWeek: slot.dayOfWeek,
      timeSlot: normalizeAvailabilityTime(slot.timeSlot),
    }))
    .filter((slot) => slot.dayOfWeek >= 0 && slot.dayOfWeek <= 4 && slot.timeSlot)
    .filter((slot) => {
      const key = `${slot.dayOfWeek}-${slot.timeSlot}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

export async function getAvailabilityByMember(
  memberId: string,
): Promise<AvailabilityResult<AvailabilitySlotRow[]>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/availability_slots?member_id=eq.${encodeURIComponent(memberId)}&select=*&order=day_of_week.asc,time_slot.asc`,
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
      message: `공강 조회 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as AvailabilitySlotRow[];
  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      time_slot: normalizeAvailabilityTime(row.time_slot),
    })),
    message: "공강 조회 성공",
  };
}

export async function getAvailabilityByTeam(
  teamId: string,
): Promise<AvailabilityResult<TeamAvailabilityEntry[]>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const membersResult = await getTeamMembersByTeam(teamId);
  if (!membersResult.ok || !membersResult.data) {
    return {
      ok: false,
      message: membersResult.message,
    };
  }

  if (membersResult.data.length === 0) {
    return {
      ok: true,
      data: [],
      message: "팀 공강 데이터가 없습니다.",
    };
  }

  const memberIds = membersResult.data.map((member) => member.id);
  const inFilter = `(${memberIds.map((memberId) => `"${memberId}"`).join(",")})`;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/availability_slots?member_id=in.${encodeURIComponent(inFilter)}&select=*&order=day_of_week.asc,time_slot.asc`,
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
      message: `팀 공강 조회 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as AvailabilitySlotRow[];
  const memberById = new Map(membersResult.data.map((member) => [member.id, member.name]));

  return {
    ok: true,
    data: rows.flatMap((row) => {
      const memberName = memberById.get(row.member_id);
      if (!memberName) {
        return [];
      }

      return [
        {
          memberId: row.member_id,
          memberName,
          day: row.day_of_week,
          time: normalizeAvailabilityTime(row.time_slot),
        },
      ];
    }),
    message: "팀 공강 조회 성공",
  };
}

export async function addAvailabilitySlot(
  memberId: string,
  slot: AvailabilitySlotInput,
): Promise<AvailabilityResult<AvailabilitySlotRow>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const normalizedTime = normalizeAvailabilityTime(slot.timeSlot);
  if (!normalizedTime) {
    return {
      ok: false,
      message: "공강 시간 형식이 올바르지 않습니다.",
    };
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/availability_slots?select=*`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify([
      {
        member_id: memberId,
        day_of_week: slot.dayOfWeek,
        time_slot: normalizedTime,
      },
    ]),
  });

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `공강 저장 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as AvailabilitySlotRow[];
  return {
    ok: true,
    data: {
      ...rows[0],
      time_slot: normalizeAvailabilityTime(rows[0].time_slot),
    },
    message: "공강 저장 성공",
  };
}

export async function deleteAvailabilitySlot(
  memberId: string,
  slot: AvailabilitySlotInput,
): Promise<AvailabilityResult<null>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const normalizedTime = normalizeAvailabilityTime(slot.timeSlot);
  if (!normalizedTime) {
    return {
      ok: false,
      message: "공강 시간 형식이 올바르지 않습니다.",
    };
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/availability_slots?member_id=eq.${encodeURIComponent(memberId)}&day_of_week=eq.${slot.dayOfWeek}&time_slot=eq.${encodeURIComponent(normalizedTime)}`,
    {
      method: "DELETE",
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
      message: `공강 삭제 실패: ${detail}`,
    };
  }

  return {
    ok: true,
    data: null,
    message: "공강 삭제 성공",
  };
}

export async function replaceMemberAvailability(
  memberId: string,
  slots: AvailabilitySlotInput[],
): Promise<AvailabilityResult<AvailabilitySlotRow[]>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const normalizedSlots = normalizeAvailabilitySlots(slots);
  const deleteResponse = await fetch(
    `${supabaseUrl}/rest/v1/availability_slots?member_id=eq.${encodeURIComponent(memberId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
    },
  );

  if (!deleteResponse.ok) {
    const detail = await parseErrorMessage(deleteResponse);
    return {
      ok: false,
      message: `기존 공강 삭제 실패: ${detail}`,
    };
  }

  if (normalizedSlots.length === 0) {
    return {
      ok: true,
      data: [],
      message: "공강 저장 성공",
    };
  }

  const insertResponse = await fetch(`${supabaseUrl}/rest/v1/availability_slots?select=*`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(
      normalizedSlots.map((slot) => ({
        member_id: memberId,
        day_of_week: slot.dayOfWeek,
        time_slot: slot.timeSlot,
      })),
    ),
  });

  if (!insertResponse.ok) {
    const detail = await parseErrorMessage(insertResponse);
    return {
      ok: false,
      message: `새 공강 저장 실패: ${detail}`,
    };
  }

  const rows = (await insertResponse.json()) as AvailabilitySlotRow[];
  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      time_slot: normalizeAvailabilityTime(row.time_slot),
    })),
    message: "공강 저장 성공",
  };
}
