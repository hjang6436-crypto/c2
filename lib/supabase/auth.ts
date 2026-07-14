import type { AuthError, Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { upsertProfile } from "@/lib/supabase/profiles";

type AuthResult = {
  ok: boolean;
  message: string;
  session: Session | null;
  user: User | null;
  needsEmailConfirmation?: boolean;
};

type SessionResult = {
  ok: boolean;
  message: string;
  session: Session | null;
  user: User | null;
};

function resolveNickname(email: string, nickname?: string) {
  const trimmed = nickname?.trim();
  if (trimmed) {
    return trimmed;
  }

  const [localPart] = email.split("@");
  return localPart || "CarryMate 사용자";
}

function normalizeAuthErrorMessage(error: AuthError | Error | null) {
  if (!error) {
    return "알 수 없는 인증 오류가 발생했습니다.";
  }

  const message = error.message.toLowerCase();

  if (message.includes("invalid login credentials")) {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }

  if (message.includes("email not confirmed")) {
    return "이메일 인증이 아직 완료되지 않았습니다. 받은 편지함을 확인해 주세요.";
  }

  if (message.includes("user already registered")) {
    return "이미 가입된 이메일입니다. 바로 로그인해 주세요.";
  }

  if (message.includes("password should be at least 6 characters")) {
    return "비밀번호는 6자 이상이어야 합니다.";
  }

  if (message.includes("invalid email")) {
    return "이메일 형식을 다시 확인해 주세요.";
  }

  if (message.includes("refresh token")) {
    return "세션이 만료되었습니다. 다시 로그인해 주세요.";
  }

  return error.message;
}

async function ensureProfile(user: User, nickname?: string | null) {
  const email = user.email?.trim();
  if (!email) {
    return {
      ok: false,
      message: "인증 사용자 이메일을 확인할 수 없어 profiles를 저장하지 못했습니다.",
    };
  }

  return upsertProfile({
    id: user.id,
    email,
    nickname: nickname ?? resolveNickname(email),
  });
}

export async function signUpWithEmail(input: {
  email: string;
  password: string;
  nickname?: string;
}): Promise<AuthResult> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
      session: null,
      user: null,
    };
  }

  const email = input.email.trim();
  const password = input.password;
  const nickname = resolveNickname(email, input.nickname);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        nickname,
      },
    },
  });

  if (error) {
    return {
      ok: false,
      message: normalizeAuthErrorMessage(error),
      session: null,
      user: null,
    };
  }

  let message = data.session
    ? "회원가입과 로그인에 성공했습니다."
    : "회원가입이 완료되었습니다. 이메일 인증 후 로그인해 주세요.";

  if (data.user) {
    const profileResult = await ensureProfile(data.user, nickname);
    if (!profileResult.ok) {
      message = `${message} ${profileResult.message}`;
    }
  }

  return {
    ok: true,
    message,
    session: data.session ?? null,
    user: data.user ?? null,
    needsEmailConfirmation: !data.session,
  };
}

export async function signInWithEmail(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
      session: null,
      user: null,
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email.trim(),
    password: input.password,
  });

  if (error) {
    return {
      ok: false,
      message: normalizeAuthErrorMessage(error),
      session: null,
      user: null,
    };
  }

  let message = "로그인에 성공했습니다.";

  if (data.user) {
    const metadataNickname =
      typeof data.user.user_metadata === "object" &&
      data.user.user_metadata !== null &&
      "nickname" in data.user.user_metadata &&
      typeof data.user.user_metadata.nickname === "string"
        ? data.user.user_metadata.nickname
        : null;
    const profileResult = await ensureProfile(data.user, metadataNickname);
    if (!profileResult.ok) {
      message = `${message} ${profileResult.message}`;
    }
  }

  return {
    ok: true,
    message,
    session: data.session,
    user: data.user,
  };
}

export async function signOut(): Promise<{
  ok: boolean;
  message: string;
}> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    return {
      ok: false,
      message: normalizeAuthErrorMessage(error),
    };
  }

  return {
    ok: true,
    message: "로그아웃되었습니다.",
  };
}

export async function getCurrentSession(): Promise<SessionResult> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
      session: null,
      user: null,
    };
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    return {
      ok: false,
      message: normalizeAuthErrorMessage(error),
      session: null,
      user: null,
    };
  }

  return {
    ok: true,
    message: data.session ? "세션 조회 성공" : "현재 로그인 세션이 없습니다.",
    session: data.session,
    user: data.session?.user ?? null,
  };
}

export async function getCurrentUser(): Promise<SessionResult> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
      session: null,
      user: null,
    };
  }

  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return {
      ok: false,
      message: normalizeAuthErrorMessage(error),
      session: null,
      user: null,
    };
  }

  return {
    ok: true,
    message: data.user ? "사용자 조회 성공" : "현재 로그인 사용자가 없습니다.",
    session: null,
    user: data.user ?? null,
  };
}

export function subscribeToAuthChanges(
  callback: (session: Session | null, user: User | null) => void,
) {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return null;
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session, session?.user ?? null);
  });

  return subscription;
}
