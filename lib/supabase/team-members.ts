import {
  hasSupabaseConfig,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/config";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { TeamRow } from "@/lib/supabase/teams";

export type TeamMemberRow = {
  id: string;
  team_id: string;
  profile_id: string | null;
  name: string;
  role: string;
  skill_tag: string;
  is_leader: boolean;
  status: string;
  joined_at: string;
};

export type CreateTeamMemberInput = {
  teamId: string;
  profileId?: string | null;
  name: string;
  role: string;
  skillTag: string;
  isLeader: boolean;
  status: string;
};

export type CreateTeamMemberSeed = Omit<CreateTeamMemberInput, "teamId">;

export type UpdateTeamMemberInput = {
  profileId?: string | null;
  name?: string;
  role?: string;
  skillTag?: string;
  isLeader?: boolean;
  status?: string;
};

type SupabaseErrorPayload = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

type TeamMemberQueryResult<T> = {
  ok: boolean;
  data?: T;
  message: string;
};

export type ProfileTeamSummary = {
  member: TeamMemberRow;
  team: TeamRow;
};

const SKILL_TAG_POOL = ["정리형", "리서치형", "비주얼형", "문서형"] as const;

function isDuplicateProfileConnectionMessage(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("duplicate") ||
    normalized.includes("unique") ||
    normalized.includes("23505")
  );
}

async function parseErrorMessage(response: Response) {
  const fallbackMessage = await response.text();
  let detail = fallbackMessage;

  try {
    const parsed = JSON.parse(fallbackMessage) as SupabaseErrorPayload;
    detail = parsed.message ?? parsed.details ?? fallbackMessage;
  } catch {
    // Response may not be JSON.
  }

  return detail;
}

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

function normalizeSeedInput(
  memberNamesOrSeeds: string[] | CreateTeamMemberSeed[],
): CreateTeamMemberSeed[] {
  if (memberNamesOrSeeds.length === 0) {
    return [];
  }

  if (typeof memberNamesOrSeeds[0] !== "string") {
    return (memberNamesOrSeeds as CreateTeamMemberSeed[])
      .map((member) => ({
        profileId: member.profileId ?? null,
        name: member.name.trim(),
        role: member.role.trim(),
        skillTag: member.skillTag.trim(),
        isLeader: member.isLeader,
        status: member.status.trim(),
      }))
      .filter((member) => member.name);
  }

  return (memberNamesOrSeeds as string[])
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name, index) => ({
      profileId: null,
      name,
      role: index === 0 ? "팀장 / 발표 정리" : "팀원",
      skillTag: SKILL_TAG_POOL[index % SKILL_TAG_POOL.length],
      isLeader: index === 0,
      status: "active",
    }));
}

async function getLinkedMemberByProfile(teamId: string, profileId: string) {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      data: null,
      errorMessage:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    return {
      data: null,
      errorMessage: error.message,
    };
  }

  return {
    data,
    errorMessage: null,
  };
}

export async function getTeamMembersByTeam(
  teamId: string,
): Promise<TeamMemberQueryResult<TeamMemberRow[]>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/team_members?team_id=eq.${encodeURIComponent(teamId)}&select=*&order=joined_at.asc`,
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
      message: `Supabase team_members 조회 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as TeamMemberRow[];
  return {
    ok: true,
    data: rows,
    message: "team_members 조회 성공",
  };
}

export async function getUnlinkedTeamMembersByTeam(
  teamId: string,
): Promise<TeamMemberQueryResult<TeamMemberRow[]>> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .is("profile_id", null)
    .order("joined_at", { ascending: true });

  if (error) {
    return {
      ok: false,
      message: `미연결 team_members 조회 실패: ${error.message}`,
    };
  }

  return {
    ok: true,
    data,
    message: "미연결 team_members 조회 성공",
  };
}

export async function createTeamMembers(
  teamId: string,
  memberNamesOrSeeds: string[] | CreateTeamMemberSeed[],
): Promise<TeamMemberQueryResult<TeamMemberRow[]>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const payload = normalizeSeedInput(memberNamesOrSeeds);

  if (payload.length === 0) {
    return {
      ok: true,
      data: [],
      message: "생성할 team_members가 없습니다.",
    };
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/team_members?select=*`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(
      payload.map((member) => ({
        team_id: teamId,
        profile_id: member.profileId ?? null,
        name: member.name,
        role: member.role,
        skill_tag: member.skillTag,
        is_leader: member.isLeader,
        status: member.status,
      })),
    ),
  });

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `Supabase team_members 생성 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as TeamMemberRow[];
  return {
    ok: true,
    data: rows,
    message: "team_members 생성 성공",
  };
}

export async function getTeamMemberByProfile(
  teamId: string,
  profileId: string,
): Promise<TeamMemberQueryResult<TeamMemberRow | null>> {
  const lookup = await getLinkedMemberByProfile(teamId, profileId);

  if (lookup.errorMessage) {
    return {
      ok: false,
      message: `현재 로그인 사용자의 team_members 조회 실패: ${lookup.errorMessage}`,
    };
  }

  return {
    ok: true,
    data: lookup.data,
    message: lookup.data
      ? "현재 로그인 사용자의 team_members 조회 성공"
      : "현재 로그인 사용자와 연결된 team_members 행이 없습니다.",
  };
}

export async function connectProfileToTeamMember(input: {
  teamId: string;
  memberId: string;
  profileId: string;
}): Promise<TeamMemberQueryResult<TeamMemberRow>> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const linkedMember = await getLinkedMemberByProfile(input.teamId, input.profileId);
  if (linkedMember.errorMessage) {
    return {
      ok: false,
      message: `같은 사용자에서 기존 profile_id 연결 여부를 확인하지 못했습니다. ${linkedMember.errorMessage}`,
    };
  }

  if (linkedMember.data) {
    return {
      ok: false,
      message: "이 계정은 이미 현재 팀의 다른 team_members 행과 연결되어 있습니다.",
    };
  }

  const { data: targetRow, error: targetError } = await supabase
    .from("team_members")
    .select("*")
    .eq("id", input.memberId)
    .eq("team_id", input.teamId)
    .single();

  if (targetError) {
    return {
      ok: false,
      message: `연결 대상 team_member 조회 실패: ${targetError.message}`,
    };
  }

  if (targetRow.profile_id) {
    return {
      ok: false,
      message: "이미 다른 계정과 연결된 팀원 항목입니다.",
    };
  }

  const { data, error } = await supabase
    .from("team_members")
    .update({
      profile_id: input.profileId,
    })
    .eq("id", input.memberId)
    .eq("team_id", input.teamId)
    .is("profile_id", null)
    .select("*")
    .single();

  if (error) {
    if (isDuplicateProfileConnectionMessage(error.message)) {
      return {
        ok: false,
        message: "이 계정은 이미 현재 팀에 참여되어 있습니다.",
      };
    }

    return {
      ok: false,
      message: `team_members profile_id 연결 실패: ${error.message}`,
    };
  }

  return {
    ok: true,
    data,
    message: "team_members profile_id 연결 성공",
  };
}

export async function createAndLinkTeamMember(input: {
  teamId: string;
  profileId: string;
  name: string;
  role?: string;
  skillTag?: string;
}): Promise<TeamMemberQueryResult<TeamMemberRow>> {
  const linkedMember = await getLinkedMemberByProfile(input.teamId, input.profileId);

  if (linkedMember.errorMessage) {
    return {
      ok: false,
      message: `기존 team_members 연결 여부 확인 실패: ${linkedMember.errorMessage}`,
    };
  }

  if (linkedMember.data) {
    return {
      ok: false,
      message: "이 계정은 이미 현재 팀의 team_members 행과 연결되어 있습니다.",
    };
  }

  const createResult = await createTeamMembers(input.teamId, [
    {
      profileId: input.profileId,
      name: input.name.trim(),
      role: input.role?.trim() || "팀원",
      skillTag: input.skillTag?.trim() || SKILL_TAG_POOL[0],
      isLeader: false,
      status: "active",
    },
  ]);

  if (!createResult.ok || !createResult.data?.[0]) {
    if (isDuplicateProfileConnectionMessage(createResult.message)) {
      return {
        ok: false,
        message: "이 계정은 이미 현재 팀에 참여되어 있습니다.",
      };
    }

    return {
      ok: false,
      message: createResult.message,
    };
  }

  return {
    ok: true,
    data: createResult.data[0],
    message: "새 team_member 생성 및 연결 성공",
  };
}

export async function linkProfileToTeamMember(
  memberId: string,
  profileId: string,
): Promise<TeamMemberQueryResult<TeamMemberRow>> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const { data, error } = await supabase
    .from("team_members")
    .update({
      profile_id: profileId,
    })
    .eq("id", memberId)
    .select("*")
    .single();

  if (error) {
    return {
      ok: false,
      message: `team_members profile_id 연결 실패: ${error.message}`,
    };
  }

  return {
    ok: true,
    data,
    message: "team_members profile_id 연결 성공",
  };
}

export async function updateTeamMember(
  memberId: string,
  updates: UpdateTeamMemberInput,
): Promise<TeamMemberQueryResult<TeamMemberRow>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const payload: Partial<TeamMemberRow> = {};

  if (updates.profileId !== undefined) {
    payload.profile_id = updates.profileId;
  }
  if (updates.name !== undefined) {
    payload.name = updates.name;
  }
  if (updates.role !== undefined) {
    payload.role = updates.role;
  }
  if (updates.skillTag !== undefined) {
    payload.skill_tag = updates.skillTag;
  }
  if (updates.isLeader !== undefined) {
    payload.is_leader = updates.isLeader;
  }
  if (updates.status !== undefined) {
    payload.status = updates.status;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/team_members?id=eq.${encodeURIComponent(memberId)}&select=*`,
    {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `Supabase team_member 수정 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as TeamMemberRow[];
  return {
    ok: true,
    data: rows[0],
    message: "team_member 수정 성공",
  };
}

export async function deleteTeamMember(
  memberId: string,
): Promise<TeamMemberQueryResult<null>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/team_members?id=eq.${encodeURIComponent(memberId)}`,
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
      message: `Supabase team_member 삭제 실패: ${detail}`,
    };
  }

  return {
    ok: true,
    data: null,
    message: "team_member 삭제 성공",
  };
}

export async function getTeamsForProfile(
  profileId: string,
): Promise<TeamMemberQueryResult<ProfileTeamSummary[]>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const memberResponse = await fetch(
    `${supabaseUrl}/rest/v1/team_members?profile_id=eq.${encodeURIComponent(profileId)}&select=*&order=joined_at.asc`,
    {
      method: "GET",
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
    },
  );

  if (!memberResponse.ok) {
    const detail = await parseErrorMessage(memberResponse);
    return {
      ok: false,
      message: `내 팀 목록 조회 실패: ${detail}`,
    };
  }

  const memberRows = (await memberResponse.json()) as TeamMemberRow[];

  if (memberRows.length === 0) {
    return {
      ok: true,
      data: [],
      message: "소속 팀이 없습니다.",
    };
  }

  const teamIds = Array.from(new Set(memberRows.map((member) => member.team_id)));
  const inFilter = `(${teamIds.map((teamId) => `"${teamId}"`).join(",")})`;
  const teamResponse = await fetch(
    `${supabaseUrl}/rest/v1/teams?id=in.${encodeURIComponent(inFilter)}&select=*`,
    {
      method: "GET",
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
    },
  );

  if (!teamResponse.ok) {
    const detail = await parseErrorMessage(teamResponse);
    return {
      ok: false,
      message: `소속 팀 상세 조회 실패: ${detail}`,
    };
  }

  const teamRows = (await teamResponse.json()) as TeamRow[];
  const teamById = new Map(teamRows.map((team) => [team.id, team]));
  const data = memberRows
    .map((member) => {
      const team = teamById.get(member.team_id);
      if (!team) {
        return null;
      }

      return {
        member,
        team,
      };
    })
    .filter((item): item is ProfileTeamSummary => Boolean(item));

  return {
    ok: true,
    data,
    message: data.length > 0 ? "내 팀 목록 조회 성공" : "소속 팀이 없습니다.",
  };
}
