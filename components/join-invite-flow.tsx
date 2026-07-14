"use client";

import type { Session, User } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getDemoWorkspace } from "@/data/carrymate";
import {
  connectProfileToTeamMember,
  createAndLinkTeamMember,
  getTeamMemberByProfile,
  getTeamMembersByTeam,
  type TeamMemberRow,
} from "@/lib/supabase/team-members";
import {
  getCurrentSession,
  signInWithEmail,
  signUpWithEmail,
  subscribeToAuthChanges,
} from "@/lib/supabase/auth";
import { getProfileById } from "@/lib/supabase/profiles";
import {
  getTeamByInviteCode,
  normalizeInviteCode,
  type TeamRow,
} from "@/lib/supabase/teams";

type AuthMode = "signIn" | "signUp";
type JoinStage =
  | "loadingTeam"
  | "teamFound"
  | "invalidCode"
  | "loginRequired"
  | "alreadyJoined"
  | "selectMember"
  | "joining"
  | "success"
  | "failure"
  | "demo";

const DEMO_INVITE_CODE = "CARRY2026";

function getUserNickname(user: User | null) {
  if (!user) {
    return "";
  }

  const metadata = user.user_metadata;
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    "nickname" in metadata &&
    typeof metadata.nickname === "string"
  ) {
    return metadata.nickname;
  }

  return user.email?.split("@")[0] ?? "";
}

function buildWorkspaceHref(inviteCode: string) {
  return `/?invite=${encodeURIComponent(inviteCode)}`;
}

function JoinAuthSheet({
  mode,
  isSubmitting,
  message,
  onChangeMode,
  onClose,
  onSignIn,
  onSignUp,
}: {
  mode: AuthMode;
  isSubmitting: boolean;
  message: string;
  onChangeMode: (mode: AuthMode) => void;
  onClose: () => void;
  onSignIn: (input: { email: string; password: string }) => Promise<void>;
  onSignUp: (input: {
    email: string;
    password: string;
    nickname: string;
  }) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [localMessage, setLocalMessage] = useState("");

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/30 px-4 pb-6 pt-24">
      <div className="mx-auto max-w-md rounded-[2rem] border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">
            {mode === "signIn" ? "로그인" : "회원가입"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-canvas px-3 py-1 text-sm font-medium text-muted"
          >
            닫기
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-canvas p-1">
          <button
            type="button"
            onClick={() => {
              setLocalMessage("");
              onChangeMode("signIn");
            }}
            className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
              mode === "signIn" ? "bg-white text-ink shadow-soft" : "text-muted"
            }`}
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => {
              setLocalMessage("");
              onChangeMode("signUp");
            }}
            className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
              mode === "signUp" ? "bg-white text-ink shadow-soft" : "text-muted"
            }`}
          >
            회원가입
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-2 block text-[13px] font-semibold text-ink">이메일</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="예: carrymate@example.com"
              className="w-full rounded-2xl border border-line bg-white px-4 py-3 outline-none transition focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[13px] font-semibold text-ink">비밀번호</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="6자 이상 입력해 주세요"
              className="w-full rounded-2xl border border-line bg-white px-4 py-3 outline-none transition focus:border-brand"
            />
          </label>
          {mode === "signUp" ? (
            <label className="block">
              <span className="mb-2 block text-[13px] font-semibold text-ink">
                닉네임 (선택)
              </span>
              <input
                type="text"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="예: 민지"
                className="w-full rounded-2xl border border-line bg-white px-4 py-3 outline-none transition focus:border-brand"
              />
            </label>
          ) : null}
        </div>

        {localMessage || message ? (
          <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-muted">
            {localMessage || message}
          </p>
        ) : null}

        <button
          type="button"
          onClick={async () => {
            if (isSubmitting) {
              return;
            }

            if (!email.trim() || !password.trim()) {
              setLocalMessage("이메일과 비밀번호를 모두 입력해 주세요.");
              return;
            }

            if (password.trim().length < 6) {
              setLocalMessage("비밀번호는 6자 이상 입력해 주세요.");
              return;
            }

            setLocalMessage("");

            if (mode === "signIn") {
              await onSignIn({ email, password });
              return;
            }

            await onSignUp({ email, password, nickname });
          }}
          className="mt-4 w-full rounded-2xl bg-brand px-4 py-4 text-sm font-semibold text-white shadow-brand"
        >
          {isSubmitting
            ? mode === "signIn"
              ? "로그인 중..."
              : "가입 중..."
            : mode === "signIn"
              ? "로그인"
              : "회원가입"}
        </button>
      </div>
    </div>
  );
}

export function JoinInviteFlow({ inviteCode }: { inviteCode: string }) {
  const router = useRouter();
  const normalizedInviteCode = useMemo(
    () => normalizeInviteCode(inviteCode),
    [inviteCode],
  );
  const demoProject = useMemo(() => getDemoWorkspace().project, []);
  const [stage, setStage] = useState<JoinStage>("loadingTeam");
  const [team, setTeam] = useState<TeamRow | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isAuthSheetOpen, setIsAuthSheetOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      const result = await getCurrentSession();

      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setAuthMessage(result.message);
      }

      setSession(result.session);
      setAuthLoading(false);
    };

    void loadSession();

    const subscription = subscribeToAuthChanges((nextSession) => {
      if (cancelled) {
        return;
      }

      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadTeam = async () => {
      if (!normalizedInviteCode) {
        setStage("invalidCode");
        setStatusMessage("초대 코드가 비어 있습니다. 링크를 다시 확인해 주세요.");
        setTeam(null);
        return;
      }

      if (normalizedInviteCode === DEMO_INVITE_CODE) {
        setStage("demo");
        setStatusMessage("기존 CARRY2026 데모 체험 흐름을 유지합니다.");
        setTeam(null);
        return;
      }

      setStage("loadingTeam");
      setStatusMessage("초대 팀 정보를 확인하고 있습니다.");

      const result = await getTeamByInviteCode(normalizedInviteCode);

      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setStage("failure");
        setStatusMessage(result.message);
        setTeam(null);
        return;
      }

      if (!result.data) {
        setStage("invalidCode");
        setStatusMessage("존재하지 않는 초대 코드입니다. 링크를 다시 확인해 주세요.");
        setTeam(null);
        return;
      }

      setTeam(result.data);
      setStage("teamFound");
      setStatusMessage("유효한 팀을 찾았습니다.");
    };

    void loadTeam();

    return () => {
      cancelled = true;
    };
  }, [normalizedInviteCode]);

  useEffect(() => {
    if (!team) {
      return;
    }

    if (authLoading) {
      return;
    }

    if (!session?.user?.id) {
      setTeamMembers([]);
      setStage("loginRequired");
      setStatusMessage("로그인 후 이 초대 링크로 다시 참여를 이어갈 수 있습니다.");
      return;
    }

    let cancelled = false;

    const prepareJoinFlow = async () => {
      const memberResult = await getTeamMemberByProfile(team.id, session.user.id);

      if (cancelled) {
        return;
      }

      if (!memberResult.ok) {
        setStage("failure");
        setStatusMessage(memberResult.message);
        return;
      }

      if (memberResult.data) {
        setStage("alreadyJoined");
        setStatusMessage("이미 이 팀에 연결되어 있습니다. 워크스페이스로 이동합니다.");
        router.replace(buildWorkspaceHref(normalizedInviteCode));
        return;
      }

      const teamMembersResult = await getTeamMembersByTeam(team.id);

      if (cancelled) {
        return;
      }

      if (!teamMembersResult.ok || !teamMembersResult.data) {
        setStage("failure");
        setStatusMessage(teamMembersResult.message);
        return;
      }

      setTeamMembers(teamMembersResult.data);
      setStage("selectMember");
      setStatusMessage("내 팀원 행을 직접 선택하거나 새 팀원으로 참여해 주세요.");
    };

    void prepareJoinFlow();

    return () => {
      cancelled = true;
    };
  }, [authLoading, normalizedInviteCode, router, session?.user?.id, team]);

  const handleSignIn = async (input: { email: string; password: string }) => {
    setIsAuthSubmitting(true);
    const result = await signInWithEmail(input);
    setIsAuthSubmitting(false);
    setAuthMessage(result.message);

    if (!result.ok) {
      return;
    }

    setSession(result.session);
    setIsAuthSheetOpen(false);
  };

  const handleSignUp = async (input: {
    email: string;
    password: string;
    nickname: string;
  }) => {
    setIsAuthSubmitting(true);
    const result = await signUpWithEmail(input);
    setIsAuthSubmitting(false);
    setAuthMessage(result.message);

    if (!result.ok) {
      return;
    }

    setSession(result.session);

    if (!result.needsEmailConfirmation) {
      setIsAuthSheetOpen(false);
    }
  };

  const refreshTeamMembers = async () => {
    if (!team) {
      return;
    }

    const result = await getTeamMembersByTeam(team.id);

    if (!result.ok || !result.data) {
      setStatusMessage(result.message);
      return;
    }

    setTeamMembers(result.data);
  };

  const handleClaimMember = async (memberId: string) => {
    if (!team || !session?.user?.id || stage === "joining") {
      return;
    }

    setStage("joining");
    setStatusMessage("선택한 팀원 행을 연결하고 있습니다.");

    const result = await connectProfileToTeamMember({
      teamId: team.id,
      memberId,
      profileId: session.user.id,
    });

    if (!result.ok) {
      setStage("failure");
      setStatusMessage(result.message);
      await refreshTeamMembers();
      return;
    }

    const currentMemberResult = await getTeamMemberByProfile(team.id, session.user.id);

    if (!currentMemberResult.ok || !currentMemberResult.data) {
      setStage("failure");
      setStatusMessage(
        currentMemberResult.ok
          ? "팀원 연결 후 내 참여 정보를 다시 확인하지 못했습니다."
          : currentMemberResult.message,
      );
      await refreshTeamMembers();
      return;
    }

    setStage("success");
    setStatusMessage("팀 참여가 완료되었습니다. 워크스페이스로 이동합니다.");
    router.replace(buildWorkspaceHref(normalizedInviteCode));
  };

  const handleCreateMember = async () => {
    if (!team || !session?.user?.id || stage === "joining") {
      return;
    }

    setStage("joining");
    setStatusMessage("새 팀원으로 참여하고 있습니다.");

    const profileResult = await getProfileById(session.user.id);
    const profileNickname = profileResult.ok ? profileResult.data?.nickname?.trim() : "";
    const fallbackName =
      session.user.email?.split("@")[0]?.trim() || getUserNickname(session.user) || "팀원";

    const result = await createAndLinkTeamMember({
      teamId: team.id,
      profileId: session.user.id,
      name: profileNickname || fallbackName,
      role: "팀원",
      skillTag: "정리형",
    });

    if (!result.ok) {
      setStage("failure");
      setStatusMessage(result.message);
      await refreshTeamMembers();
      return;
    }

    const currentMemberResult = await getTeamMemberByProfile(team.id, session.user.id);

    if (!currentMemberResult.ok || !currentMemberResult.data) {
      setStage("failure");
      setStatusMessage(
        currentMemberResult.ok
          ? "새 팀원 참여 후 내 참여 정보를 다시 확인하지 못했습니다."
          : currentMemberResult.message,
      );
      await refreshTeamMembers();
      return;
    }

    setStage("success");
    setStatusMessage("새 팀원 참여가 완료되었습니다. 워크스페이스로 이동합니다.");
    router.replace(buildWorkspaceHref(normalizedInviteCode));
  };

  const unlinkedMembers = teamMembers.filter((member) => member.profile_id === null);
  const connectedMembers = teamMembers.filter((member) => member.profile_id !== null);
  const isJoining = stage === "joining";

  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-10 pt-7">
        <div className="rounded-[2rem] border border-line bg-white p-5 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand">
            CarryMate Invite
          </p>
          <h1 className="mt-2 text-[25px] font-semibold tracking-[-0.02em] text-ink">
            {normalizedInviteCode === DEMO_INVITE_CODE
              ? demoProject.name
              : team?.team_name ?? "팀 초대 링크"}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {normalizedInviteCode === DEMO_INVITE_CODE
              ? `${demoProject.courseName} · 데모 초대 코드 ${DEMO_INVITE_CODE}`
              : team
                ? `${team.course_name} · 초대 코드 ${normalizedInviteCode}`
                : `초대 코드 ${normalizedInviteCode || "-"}`}
          </p>
          <p className="mt-4 rounded-2xl bg-canvas px-4 py-3 text-[13px] leading-6 text-muted">
            {statusMessage}
          </p>
        </div>

        {stage === "loadingTeam" ? (
          <section className="mt-4 rounded-[2rem] border border-line bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-ink">팀 정보를 불러오는 중입니다.</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              초대 코드와 연결된 실제 팀을 확인하고 있습니다.
            </p>
          </section>
        ) : null}

        {stage === "invalidCode" ? (
          <section className="mt-4 rounded-[2rem] border border-line bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-ink">존재하지 않는 초대 링크입니다.</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              링크가 잘렸거나 만료된 것이 아니라면, 초대한 팀원에게 다시 공유를 요청해
              주세요.
            </p>
            <button
              type="button"
              onClick={() => router.replace("/")}
              className="mt-4 w-full rounded-2xl border border-line bg-white px-4 py-4 text-sm font-semibold text-ink shadow-soft"
            >
              홈으로 돌아가기
            </button>
          </section>
        ) : null}

        {stage === "demo" ? (
          <section className="mt-4 rounded-[2rem] border border-line bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-ink">CARRY2026 데모 초대입니다.</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              기존 데모 진입 fallback을 유지합니다. 링크 참여와 QR 테스트도 동일하게 이
              라우트를 거쳐 데모 워크스페이스로 이동합니다.
            </p>
            <button
              type="button"
              onClick={() => router.replace(buildWorkspaceHref(DEMO_INVITE_CODE))}
              className="mt-4 w-full rounded-2xl bg-brand px-4 py-4 text-sm font-semibold text-white shadow-brand"
            >
              데모 팀으로 입장하기
            </button>
          </section>
        ) : null}

        {stage === "loginRequired" && team ? (
          <section className="mt-4 rounded-[2rem] border border-line bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-ink">
              {team.team_name} 팀에 참여하려면 로그인 또는 회원가입이 필요합니다.
            </p>
            <p className="mt-2 text-sm leading-6 text-muted">
              로그인 후 이 초대 링크의 참여 흐름으로 자동 복귀합니다. 다시 코드를 입력할
              필요는 없습니다.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signIn");
                  setAuthMessage("");
                  setIsAuthSheetOpen(true);
                }}
                className="rounded-2xl border border-line bg-white px-4 py-4 text-sm font-semibold text-ink"
              >
                로그인
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode("signUp");
                  setAuthMessage("");
                  setIsAuthSheetOpen(true);
                }}
                className="rounded-2xl bg-brand px-4 py-4 text-sm font-semibold text-white shadow-brand"
              >
                회원가입
              </button>
            </div>
          </section>
        ) : null}

        {stage === "selectMember" && team ? (
          <section className="mt-4 space-y-4">
            <div className="rounded-[2rem] border border-line bg-white p-5 shadow-soft">
              <p className="text-sm font-semibold text-ink">기존 초대 대상 팀원 선택</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                이름이 같아도 자동 연결하지 않습니다. 내 팀원 행을 직접 선택해 주세요.
              </p>
              <div className="mt-4 space-y-3">
                {teamMembers.length > 0 ? (
                  teamMembers.map((member) => {
                    const isLinked = Boolean(member.profile_id);
                    return (
                      <button
                        key={member.id}
                        type="button"
                        disabled={isJoining || isLinked}
                        onClick={() => handleClaimMember(member.id)}
                        className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-4 text-left shadow-soft disabled:opacity-60"
                      >
                        <div>
                          <p className="text-sm font-semibold text-ink">{member.name}</p>
                          <p className="mt-1 text-[12px] text-muted">
                            {member.role} · {member.skill_tag}
                          </p>
                        </div>
                        <span className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-muted">
                          {isLinked ? "이미 연결됨" : "선택"}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-line bg-canvas px-4 py-4 text-sm leading-6 text-muted">
                    초대된 팀원 목록이 아직 없습니다. 아래에서 새 팀원으로 바로 참여할 수
                    있습니다.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[2rem] border border-line bg-white p-5 shadow-soft">
              <p className="text-sm font-semibold text-ink">목록에 없음</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                현재 선택 가능한 미연결 팀원은 {unlinkedMembers.length}명입니다.
                {connectedMembers.length > 0
                  ? ` 이미 연결된 팀원 ${connectedMembers.length}명은 선택할 수 없습니다.`
                  : ""}
              </p>
              <button
                type="button"
                disabled={isJoining}
                onClick={handleCreateMember}
                className="mt-4 w-full rounded-2xl border border-line bg-white px-4 py-4 text-sm font-semibold text-ink shadow-soft disabled:opacity-60"
              >
                {isJoining ? "참여 처리 중..." : "목록에 없음 - 새 팀원으로 참여"}
              </button>
            </div>
          </section>
        ) : null}

        {stage === "alreadyJoined" || stage === "success" ? (
          <section className="mt-4 rounded-[2rem] border border-line bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-ink">실제 팀 워크스페이스로 이동합니다.</p>
            <button
              type="button"
              onClick={() => router.replace(buildWorkspaceHref(normalizedInviteCode))}
              className="mt-4 w-full rounded-2xl bg-brand px-4 py-4 text-sm font-semibold text-white shadow-brand"
            >
              지금 입장하기
            </button>
          </section>
        ) : null}

        {stage === "joining" ? (
          <section className="mt-4 rounded-[2rem] border border-line bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-ink">팀 참여를 처리하고 있습니다.</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              중복 클릭을 막기 위해 버튼이 잠시 비활성화됩니다.
            </p>
          </section>
        ) : null}

        {stage === "failure" ? (
          <section className="mt-4 rounded-[2rem] border border-line bg-white p-5 shadow-soft">
            <p className="text-sm font-semibold text-ink">참여 처리에 실패했습니다.</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              다른 계정에 이미 연결된 행은 가져올 수 없습니다. 같은 팀 중복 참여도
              허용되지 않습니다.
            </p>
            {team ? (
              <button
                type="button"
                onClick={async () => {
                  await refreshTeamMembers();
                  setStage(session?.user ? "selectMember" : "loginRequired");
                  setStatusMessage(
                    session?.user
                      ? "다시 선택해 주세요. 이미 연결된 팀원 행은 선택할 수 없습니다."
                      : "로그인 후 다시 참여를 시도해 주세요.",
                  );
                }}
                className="mt-4 w-full rounded-2xl border border-line bg-white px-4 py-4 text-sm font-semibold text-ink shadow-soft"
              >
                다시 시도하기
              </button>
            ) : null}
          </section>
        ) : null}
      </main>

      {isAuthSheetOpen ? (
        <JoinAuthSheet
          mode={authMode}
          isSubmitting={isAuthSubmitting}
          message={authMessage}
          onChangeMode={setAuthMode}
          onClose={() => {
            if (isAuthSubmitting) {
              return;
            }
            setIsAuthSheetOpen(false);
          }}
          onSignIn={handleSignIn}
          onSignUp={handleSignUp}
        />
      ) : null}
    </>
  );
}
