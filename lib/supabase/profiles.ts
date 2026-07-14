import type { PostgrestError } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type ProfileRow = {
  id: string;
  email: string;
  nickname: string | null;
  created_at: string;
};

type UpsertProfileInput = {
  id: string;
  email: string;
  nickname?: string | null;
};

type ProfileResult<T> = {
  ok: boolean;
  data?: T;
  message: string;
};

function normalizeProfileErrorMessage(error: PostgrestError | Error | null) {
  if (!error) {
    return "알 수 없는 profiles 오류가 발생했습니다.";
  }

  const message = error.message.toLowerCase();

  if (message.includes("row-level security")) {
    return "profiles 테이블 RLS 정책 때문에 요청이 차단되었습니다.";
  }

  if (message.includes("duplicate")) {
    return "이미 같은 이메일 프로필이 존재합니다.";
  }

  return error.message;
}

export async function upsertProfile(
  input: UpsertProfileInput,
): Promise<ProfileResult<ProfileRow>> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: input.id,
        email: input.email.trim(),
        nickname: input.nickname?.trim() || null,
      },
      {
        onConflict: "id",
      },
    )
    .select("*")
    .single();

  if (error) {
    return {
      ok: false,
      message: `profiles 저장 실패: ${normalizeProfileErrorMessage(error)}`,
    };
  }

  return {
    ok: true,
    data,
    message: "profiles 저장 성공",
  };
}

export async function getProfileById(
  profileId: string,
): Promise<ProfileResult<ProfileRow | null>> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      message: `profiles 조회 실패: ${normalizeProfileErrorMessage(error)}`,
    };
  }

  return {
    ok: true,
    data,
    message: data ? "profiles 조회 성공" : "연결된 profile이 없습니다.",
  };
}
