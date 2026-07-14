"use client";

import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ModalShell } from "@/components/modal-shell";
import { CarryMateLogo } from "@/components/carrymate-logo";
import { FileTab } from "@/components/file-tab";
import { HomeTab } from "@/components/home-tab";
import { MeetingRoomSheet } from "@/components/meeting-room-sheet";
import { TeamAssistantPanel } from "@/components/team-assistant-panel";
import { ScheduleTab } from "@/components/schedule-tab";
import { TaskTab } from "@/components/task-tab";
import { getDemoWorkspace } from "@/data/carrymate";
import { buildTeamAssistantContext } from "@/lib/carrymate/assistant-context";
import {
  formatTaskDueLabel,
  getMeetingStatus,
  isUuid,
  mapMeetingNoteRowToMeetingNote,
  mapMeetingRowsToConfirmedMeetings,
  mapTeamRowToProject,
  mapTaskRowsToTasks,
  mapTeamMemberRowsToTeamMembers,
} from "@/lib/mappers/carrymate";
import { mapTeamFileRecordsToFileItems } from "@/lib/mappers/files";
import { formatDeadlineLabel } from "@/lib/carrymate/project-dates";
import {
  createMeeting,
  createMeetingNote,
  getMeetingsByTeam,
  getMeetingNotesByTeam,
} from "@/lib/supabase/meetings";
import {
  getTeamFileSignedUrl,
  getTeamFiles,
  createTeamLinkResource,
  updateTeamResource,
  deleteTeamResource,
  uploadTeamFile,
} from "@/lib/supabase/files";
import { serializeMeetingNoteContent } from "@/lib/carrymate/meeting-note-content";
import {
  getAvailabilityByTeam,
  normalizeAvailabilityTime,
  replaceMemberAvailability,
  type TeamAvailabilityEntry,
} from "@/lib/supabase/availability";
import {
  createTask,
  getTasksByTeam,
  updateTaskFields,
} from "@/lib/supabase/tasks";
import {
  connectProfileToTeamMember,
  createAndLinkTeamMember,
  createTeamMembers,
  getTeamMemberByProfile,
  getTeamMembersByTeam,
  getTeamsForProfile,
  getUnlinkedTeamMembersByTeam,
  deleteTeamMember,
  type ProfileTeamSummary,
  type CreateTeamMemberSeed,
  type TeamMemberRow,
} from "@/lib/supabase/team-members";
import {
  getCurrentSession,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  subscribeToAuthChanges,
} from "@/lib/supabase/auth";
import {
  generateInviteCode,
  getTeamById,
  getTeamByInviteCode,
  normalizeInviteCode,
  saveTeamToSupabase,
} from "@/lib/supabase/teams";
import {
  ConfirmedMeeting,
  FileItem,
  HealthStatus,
  MeetingActionItem,
  MeetingNote,
  Project,
  ScheduleSlot,
  TabId,
  Task,
  TaskStatus,
  TeamMember,
} from "@/types/carrymate";

type ViewMode = "onboarding" | "workspace";
type WorkspaceSheetMode = "task" | "schedule" | "meeting" | null;
type OnboardingSheetMode =
  | "createTeam"
  | "joinTeam"
  | "joinLink"
  | "joinQr"
  | "shareInvite"
  | null;
type AuthMode = "signIn" | "signUp";
type MeetingDraftInput = {
  title: string;
  startsAt: string;
  endsAt: string;
  agenda: string;
};

type ProjectSummary = {
  totalCount: number;
  todayTaskCount: number;
  todoCount: number;
  inProgressCount: number;
  doneCount: number;
  overdueCount: number;
  unassignedCount: number;
  urgentTask?: Task;
  progress: number;
  healthScore: number;
  healthStatus: HealthStatus;
  briefing: string;
};

const DEFAULT_AVAILABILITY = ["수 18:00", "목 14:00", "목 19:00"];
const ROLE_POOL = ["팀장 / 진행 정리", "자료 조사", "디자인", "문서 작성"];
const SKILL_POOL = ["정리형", "리서치형", "비주얼형", "문서형"];
const DEMO_INVITE_CODE = "CARRY2026";
const LAST_TEAM_ID_STORAGE_KEY = "carrymate:last-team-id";
const LAST_TAB_STORAGE_KEY = "carrymate:last-tab";
const AVAILABILITY_DAY_LABELS = ["월", "화", "수", "목", "금"];

function buildAvailabilityKey(day: number, time: string) {
  return `${day}|${normalizeAvailabilityTime(time)}`;
}

function formatAvailabilityLabel(day: number, time: string) {
  const normalizedTime = normalizeAvailabilityTime(time);
  if (!normalizedTime || day < 0 || day >= AVAILABILITY_DAY_LABELS.length) {
    return "";
  }

  return `${AVAILABILITY_DAY_LABELS[day]} ${normalizedTime}`;
}

function getTaskDueAt(daysFromToday: number, hour = 18) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString();
}

function getEffectiveDueAt(task: Task) {
  if (task.dueAt) {
    return task.dueAt;
  }

  if (task.dueLabel === "오늘") {
    return getTaskDueAt(0, 18);
  }

  if (task.dueLabel === "내일") {
    return getTaskDueAt(1, 18);
  }

  return null;
}

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

function normalizeMemberNameKey(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function dedupeMemberNames(names: string[]) {
  const seen = new Set<string>();

  return names.filter((name) => {
    const key = normalizeMemberNameKey(name);
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildInviteLink(inviteCode: string) {
  const origin =
    typeof window !== "undefined" && window.location.origin
      ? window.location.origin
      : "https://carrymate.app";

  return `${origin}/join/${inviteCode}`;
}

function formatMeetingDateLabel(startsAt: string) {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) {
    return "회의 일정";
  }

  const today = new Date();
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return "오늘";
  }

  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function mergeMeetingsWithNotes(
  meetings: ConfirmedMeeting[],
  notes: MeetingNote[],
) {
  const noteByMeetingId = new Map<string, MeetingNote>();

  notes.forEach((note) => {
    if (!note.meetingId || noteByMeetingId.has(note.meetingId)) {
      return;
    }

    noteByMeetingId.set(note.meetingId, note);
  });

  return meetings.map((meeting) => {
    const note = noteByMeetingId.get(meeting.id);
    if (!note) {
      return meeting;
    }

    return {
      ...meeting,
      agenda: note.agenda,
      aiSummary: note.aiSummary ?? undefined,
      aiDecisions: note.aiDecisions,
      aiUnresolvedItems: note.aiUnresolvedItems,
      aiActionItems: note.aiActionItems,
      noteId: note.id,
      pinnedMessages: note.pinnedMessages,
    };
  });
}

function formatMeetingTimeRange(startsAt: string, endsAt?: string | null) {
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;

  if (Number.isNaN(start.getTime())) {
    return "시간 미정";
  }

  const startLabel = start.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (!end || Number.isNaN(end.getTime())) {
    return `${startLabel} - 진행 중`;
  }

  const endLabel = end.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return `${startLabel} - ${endLabel}`;
}

export function CarryMateApp({
  initialInviteCode,
}: {
  initialInviteCode?: string;
}) {
  const router = useRouter();
  // TODO: Supabase Auth/Router 연동 시 온보딩 여부와 현재 탭 상태는
  // 세션/유저 프로필/URL 상태를 기준으로 초기화하도록 교체 가능
  const [viewMode, setViewMode] = useState<ViewMode>("onboarding");
  const [activeTab, setActiveTab] = useState<TabId>("home");

  // TODO: Supabase 연동 시 아래 workspace 상태들은 `getDemoWorkspace()` 대신
  // 초기 fetch 결과와 subscription(on realtime change) 데이터로 대체 가능
  const [project, setProject] = useState<Project>(() => getDemoWorkspace().project);
  const [members, setMembers] = useState<TeamMember[]>(() => getDemoWorkspace().members);
  const [tasks, setTasks] = useState<Task[]>(() => getDemoWorkspace().tasks);
  const [scheduleSlots, setScheduleSlots] = useState<ScheduleSlot[]>(
    () => getDemoWorkspace().scheduleSlots,
  );
  const [confirmedMeetings, setConfirmedMeetings] = useState<ConfirmedMeeting[]>(
    () => getDemoWorkspace().meetings,
  );
  const [files, setFiles] = useState<FileItem[]>(() => getDemoWorkspace().files);
  const [taskSyncMessage, setTaskSyncMessage] = useState("");
  const [memberSyncMessage, setMemberSyncMessage] = useState("");
  const [meetingSyncMessage, setMeetingSyncMessage] = useState("");
  const [fileSyncMessage, setFileSyncMessage] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [memberLinkMessage, setMemberLinkMessage] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [fileCreateDialogRequestId, setFileCreateDialogRequestId] = useState(0);
  const [pendingTeamAction, setPendingTeamAction] = useState<
    | { kind: "leave"; summary: ProfileTeamSummary }
    | { kind: "delete"; summary: ProfileTeamSummary }
    | null
  >(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isMemberLinkLoading, setIsMemberLinkLoading] = useState(false);
  const [isAuthSheetOpen, setIsAuthSheetOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isMemberLinkSheetOpen, setIsMemberLinkSheetOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("signIn");
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [currentMember, setCurrentMember] = useState<TeamMember | null>(null);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isMyPageOpen, setIsMyPageOpen] = useState(false);
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const [unlinkedMemberRows, setUnlinkedMemberRows] = useState<TeamMemberRow[]>([]);
  const [isTaskCreating, setIsTaskCreating] = useState(false);
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([]);
  const tasksRef = useRef(tasks);
  const membersRef = useRef(members);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const handledInviteCodeRef = useRef("");

  // TODO: Supabase 연동 시 아래 UI 상태들은 서버 저장 대상이 아니라
  // 클라이언트 전용 로컬 UI 상태로 그대로 유지하거나 zustand/router state로 분리 가능
  const [sheetMode, setSheetMode] = useState<WorkspaceSheetMode>(null);
  const [onboardingSheetMode, setOnboardingSheetMode] =
    useState<OnboardingSheetMode>(null);
  // TODO: Supabase 연동 시 inviteError/copyFeedback는 서버 에러 메시지나
  // 공유 성공 토스트 상태로 대체 가능
  const [inviteError, setInviteError] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [teamSaveMessage, setTeamSaveMessage] = useState("");
  const [pendingMemberExitId, setPendingMemberExitId] = useState<string | null>(
    null,
  );
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [meetingDraftPreset, setMeetingDraftPreset] = useState<MeetingDraftInput | null>(
    null,
  );
  const [myTeams, setMyTeams] = useState<ProfileTeamSummary[]>([]);
  const [myTeamsLoading, setMyTeamsLoading] = useState(false);
  const [myTeamsMessage, setMyTeamsMessage] = useState("");
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [workspaceLoadMessage, setWorkspaceLoadMessage] = useState("");
  const [teamAvailability, setTeamAvailability] = useState<TeamAvailabilityEntry[]>([]);
  const [selectedAvailabilityKeys, setSelectedAvailabilityKeys] = useState<string[]>([]);
  const [initialAvailabilityKeys, setInitialAvailabilityKeys] = useState<string[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState("");

  const assistantContext = useMemo(
    () =>
      buildTeamAssistantContext({
        project,
        members,
        tasks,
        meetings: confirmedMeetings,
        teamAvailability,
        files,
      }),
    [confirmedMeetings, files, members, project, tasks, teamAvailability],
  );
  const [isRestoringWorkspace, setIsRestoringWorkspace] = useState(
    () => !normalizeInviteCode(initialInviteCode),
  );
  const restoredTeamRef = useRef(false);
  const restoreAttemptKeyRef = useRef<string | null>(null);
  const loadWorkspaceFromTeamIdRef = useRef<
    (options: {
      source: "card" | "restore" | "invite";
      teamId: string;
      memberRow?: TeamMemberRow | null;
    }) => Promise<boolean>
  >(async () => false);

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === "active"),
    [members],
  );
  const hasPersistentProjectId = isUuid(project.id);
  const authenticatedUser = session?.user ?? null;
  const isAuthenticated = Boolean(authenticatedUser);
  const isTeamMember = Boolean(currentMember);
  const isTeamLeader = Boolean(currentMember?.isLeader);
  const currentTeamSummary = useMemo(
    () => myTeams.find((summary) => summary.team.id === project.id) ?? null,
    [myTeams, project.id],
  );
  const userNickname = getUserNickname(authenticatedUser ?? user);
  const inviteCode = project.inviteCode || (!hasPersistentProjectId ? DEMO_INVITE_CODE : "");
  const inviteLink = inviteCode ? buildInviteLink(inviteCode) : "";
  const workspaceInviteCode = normalizeInviteCode(initialInviteCode);
  const editableAvailabilityMember = useMemo(() => {
    if (currentMember) {
      return currentMember;
    }

    if (!hasPersistentProjectId) {
      return activeMembers[0] ?? null;
    }

    return null;
  }, [activeMembers, currentMember, hasPersistentProjectId]);
  const scheduleMembers = useMemo(() => {
    if (teamAvailability.length === 0) {
      return members;
    }

    const availabilityByMemberId = new Map<string, string[]>();
    teamAvailability.forEach((entry) => {
      const current = availabilityByMemberId.get(entry.memberId) ?? [];
      current.push(formatAvailabilityLabel(entry.day, entry.time));
      availabilityByMemberId.set(entry.memberId, current);
    });

    return members.map((member) => ({
      ...member,
      availability: availabilityByMemberId.get(member.id) ?? member.availability,
    }));
  }, [members, teamAvailability]);
  const hasAvailabilityChanges = useMemo(() => {
    if (selectedAvailabilityKeys.length !== initialAvailabilityKeys.length) {
      return true;
    }

    return selectedAvailabilityKeys.some(
      (key, index) => key !== initialAvailabilityKeys[index],
    );
  }, [initialAvailabilityKeys, selectedAvailabilityKeys]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (!isMenuOpen) {
      document.body.style.overflow = "";
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const menuButtonElement = menuButtonRef.current;
    document.body.style.overflow = "hidden";

    const focusTarget = window.setTimeout(() => {
      firstMenuItemRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(focusTarget);
      document.body.style.overflow = previousOverflow;
      menuButtonElement?.focus();
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const savedTab = window.localStorage.getItem(LAST_TAB_STORAGE_KEY);
    if (
      savedTab === "home" ||
      savedTab === "tasks" ||
      savedTab === "schedule" ||
      savedTab === "files"
    ) {
      setActiveTab(savedTab);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      const result = await getCurrentSession();

      if (cancelled) {
        return;
      }

      if (!result.ok) {
        console.error(result.message);
        setAuthMessage(result.message);
      }

      setSession(result.session);
      setUser(result.user);
      setAuthLoading(false);
    };

    void loadSession();

    const subscription = subscribeToAuthChanges((nextSession, nextUser) => {
      if (cancelled) {
        return;
      }

      setSession(nextSession);
      setUser(nextUser);
      setAuthLoading(false);

      if (!nextUser) {
        setCurrentMember(null);
      }
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsSplashVisible(false);
    }, 1300);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!authenticatedUser?.id) {
      setMyTeams([]);
      setMyTeamsMessage("");
      setMyTeamsLoading(false);
      restoredTeamRef.current = false;
      return;
    }

    let cancelled = false;

    const loadMyTeams = async () => {
      setMyTeamsLoading(true);
      setMyTeamsMessage("내 팀을 불러오는 중입니다.");
      const result = await getTeamsForProfile(authenticatedUser.id);

      if (cancelled) {
        return;
      }

      setMyTeamsLoading(false);

      if (!result.ok || !result.data) {
        setMyTeams([]);
        setMyTeamsMessage(result.message);
        return;
      }

      setMyTeams(result.data);
      setMyTeamsMessage(
        result.data.length > 0 ? "" : "아직 소속된 실제 팀이 없습니다.",
      );
    };

    void loadMyTeams();

    return () => {
      cancelled = true;
    };
  }, [authenticatedUser?.id]);

  useEffect(() => {
    if (typeof window === "undefined" || authLoading || workspaceInviteCode) {
      return;
    }

    if (!authenticatedUser?.id) {
      setIsRestoringWorkspace(false);
      restoredTeamRef.current = false;
      restoreAttemptKeyRef.current = null;
      return;
    }

    const savedTeamId = window.localStorage.getItem(LAST_TEAM_ID_STORAGE_KEY);
    if (!savedTeamId) {
      setIsRestoringWorkspace(false);
      return;
    }

    const restoreAttemptKey = `${authenticatedUser.id}:${savedTeamId}`;
    if (restoredTeamRef.current || restoreAttemptKeyRef.current === restoreAttemptKey) {
      return;
    }

    restoredTeamRef.current = true;
    restoreAttemptKeyRef.current = restoreAttemptKey;
    setIsRestoringWorkspace(true);

    let cancelled = false;

    const restoreWorkspace = async () => {
      const membershipResult = await getTeamMemberByProfile(
        savedTeamId,
        authenticatedUser.id,
      );

      if (cancelled) {
        return;
      }

      if (!membershipResult.ok) {
        console.error("Workspace restore membership query failed.", {
          savedTeamId,
          userId: authenticatedUser.id,
          membershipError: membershipResult.message,
        });
        window.localStorage.removeItem(LAST_TEAM_ID_STORAGE_KEY);
        setWorkspaceLoadMessage("마지막 팀 복원에 실패했습니다.");
        setIsRestoringWorkspace(false);
        setViewMode("onboarding");
        return;
      }

      if (!membershipResult.data) {
        console.error("Workspace restore membership missing.", {
          savedTeamId,
          userId: authenticatedUser.id,
          membershipError: "No team_members row for saved team and current user.",
        });
        window.localStorage.removeItem(LAST_TEAM_ID_STORAGE_KEY);
        setWorkspaceLoadMessage("마지막 팀 복원에 실패했습니다.");
        setIsRestoringWorkspace(false);
        setViewMode("onboarding");
        return;
      }

      const restored = await loadWorkspaceFromTeamIdRef.current({
        source: "restore",
        teamId: savedTeamId,
        memberRow: membershipResult.data,
      });

      if (cancelled) {
        return;
      }

      if (!restored) {
        console.error("Workspace restore data load failed.", {
          savedTeamId,
          userId: authenticatedUser.id,
          membershipError: null,
        });
        setViewMode("onboarding");
      }

      setIsRestoringWorkspace(false);
    };

    void restoreWorkspace();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    authenticatedUser?.id,
    workspaceInviteCode,
  ]);

  useEffect(() => {
    if (!hasPersistentProjectId) {
      return;
    }

    let cancelled = false;

    const loadTasks = async () => {
      const result = await getTasksByTeam(project.id);

      if (cancelled) {
        return;
      }

      if (!result.ok || !result.data) {
        console.error(result.message);
        setTaskSyncMessage(result.message);
        return;
      }

      if (
        result.data.length === 0 &&
        tasksRef.current.some((task) => !isUuid(task.id))
      ) {
        setTaskSyncMessage("");
        return;
      }

      setTasks(mapTaskRowsToTasks(result.data));
      setTaskSyncMessage("");
    };

    void loadTasks();

    return () => {
      cancelled = true;
    };
  }, [hasPersistentProjectId, project.id]);

  useEffect(() => {
    if (!hasPersistentProjectId) {
      return;
    }

    let cancelled = false;

    const loadMembers = async () => {
      const result = await getTeamMembersByTeam(project.id);

      if (cancelled) {
        return;
      }

      if (!result.ok || !result.data) {
        console.error(result.message);
        setMemberSyncMessage(result.message);
        return;
      }

      if (
        result.data.length === 0 &&
        membersRef.current.some((member) => !isUuid(member.id))
      ) {
        setMemberSyncMessage("");
        return;
      }

      setMembers(mapTeamMemberRowsToTeamMembers(result.data));
      setMemberSyncMessage("");
    };

    void loadMembers();

    return () => {
      cancelled = true;
    };
  }, [hasPersistentProjectId, project.id]);

  useEffect(() => {
    if (!hasPersistentProjectId) {
      return;
    }

    let cancelled = false;

    const loadMeetings = async () => {
      const [meetingResult, noteResult] = await Promise.all([
        getMeetingsByTeam(project.id),
        getMeetingNotesByTeam(project.id),
      ]);

      if (cancelled) {
        return;
      }

      if (!meetingResult.ok || !meetingResult.data) {
        console.error(meetingResult.message);
        setMeetingSyncMessage(meetingResult.message);
        return;
      }

      const mappedMeetings = mapMeetingRowsToConfirmedMeetings(meetingResult.data);
      const mappedNotes =
        noteResult.ok && noteResult.data
          ? noteResult.data.map(mapMeetingNoteRowToMeetingNote)
          : [];

      setConfirmedMeetings(mergeMeetingsWithNotes(mappedMeetings, mappedNotes));
      setMeetingSyncMessage(noteResult.ok ? "" : noteResult.message);
    };

    void loadMeetings();

    return () => {
      cancelled = true;
    };
  }, [hasPersistentProjectId, project.id]);

  useEffect(() => {
    if (!hasPersistentProjectId || !authenticatedUser?.id) {
      setCurrentMember(null);
      return;
    }

    let cancelled = false;

    const loadCurrentMember = async () => {
      const result = await getTeamMemberByProfile(project.id, authenticatedUser.id);

      if (cancelled) {
        return;
      }

      if (!result.ok) {
        console.error(result.message);
        setAuthMessage(result.message);
        return;
      }

      setCurrentMember(
        result.data ? mapTeamMemberRowsToTeamMembers([result.data])[0] : null,
      );
    };

    void loadCurrentMember();

    return () => {
      cancelled = true;
    };
  }, [authenticatedUser?.id, hasPersistentProjectId, project.id]);

  useEffect(() => {
    if (!hasPersistentProjectId) {
      const demoMember = editableAvailabilityMember;
      const demoKeys = demoMember
        ? [...new Set(demoMember.availability.map((value) => {
            const [dayLabel, time] = value.split(" ");
            const day = AVAILABILITY_DAY_LABELS.indexOf(dayLabel);
            return day >= 0 ? buildAvailabilityKey(day, time ?? "") : "";
          }).filter(Boolean))].sort()
        : [];
      setTeamAvailability(
        activeMembers.flatMap((member) =>
          member.availability.flatMap((value) => {
            const [dayLabel, time] = value.split(" ");
            const day = AVAILABILITY_DAY_LABELS.indexOf(dayLabel);
            const normalizedTime = normalizeAvailabilityTime(time ?? "");
            if (day < 0 || !normalizedTime) {
              return [];
            }

            return [
              {
                memberId: member.id,
                memberName: member.name,
                day,
                time: normalizedTime,
              },
            ];
          }),
        ),
      );
      setSelectedAvailabilityKeys(demoKeys);
      setInitialAvailabilityKeys(demoKeys);
      setAvailabilityLoading(false);
      setAvailabilityMessage("");
      return;
    }

    let cancelled = false;

    const loadAvailability = async () => {
      setAvailabilityLoading(true);
      setAvailabilityMessage("공강 불러오는 중");
      const result = await getAvailabilityByTeam(project.id);

      if (cancelled) {
        return;
      }

      setAvailabilityLoading(false);

      if (!result.ok || !result.data) {
        setTeamAvailability([]);
        setAvailabilityMessage(result.message);
        return;
      }

      setTeamAvailability(result.data);
      setAvailabilityMessage("");
    };

    void loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [activeMembers, editableAvailabilityMember, hasPersistentProjectId, project.id]);

  useEffect(() => {
    const targetMember = editableAvailabilityMember;
    if (!targetMember) {
      setSelectedAvailabilityKeys([]);
      setInitialAvailabilityKeys([]);
      return;
    }

    const memberKeys = teamAvailability
      .filter((entry) => entry.memberId === targetMember.id)
      .map((entry) => buildAvailabilityKey(entry.day, entry.time))
      .sort();

    setSelectedAvailabilityKeys(memberKeys);
    setInitialAvailabilityKeys(memberKeys);
  }, [editableAvailabilityMember, teamAvailability]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (viewMode !== "workspace" || !hasPersistentProjectId) {
      return;
    }

    window.localStorage.setItem(LAST_TAB_STORAGE_KEY, activeTab);
  }, [activeTab, hasPersistentProjectId, viewMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (hasPersistentProjectId && project.id) {
      window.localStorage.setItem(LAST_TEAM_ID_STORAGE_KEY, project.id);
      return;
    }

    if (authLoading || isRestoringWorkspace || viewMode !== "workspace") {
      return;
    }

    window.localStorage.removeItem(LAST_TEAM_ID_STORAGE_KEY);
  }, [authLoading, hasPersistentProjectId, isRestoringWorkspace, project.id, viewMode]);

  useEffect(() => {
    if (!workspaceInviteCode) {
      handledInviteCodeRef.current = "";
      return;
    }

    if (handledInviteCodeRef.current === workspaceInviteCode) {
      return;
    }

    handledInviteCodeRef.current = workspaceInviteCode;

    if (workspaceInviteCode === DEMO_INVITE_CODE) {
      loadDemoWorkspace();
      return;
    }

    let cancelled = false;

    const loadWorkspaceFromInviteCode = async () => {
      setInviteError("");
      setTeamSaveMessage("");

      const teamResult = await getTeamByInviteCode(workspaceInviteCode);

      if (cancelled) {
        return;
      }

      if (!teamResult.ok || !teamResult.data) {
        setInviteError(
          teamResult.ok
            ? "존재하지 않는 초대 코드입니다. 링크를 다시 확인해 주세요."
            : teamResult.message,
        );
        setViewMode("onboarding");
        return;
      }
      await loadWorkspaceFromTeamIdRef.current({
        source: "invite",
        teamId: teamResult.data.id,
      });
    };

    void loadWorkspaceFromInviteCode();

    return () => {
      cancelled = true;
    };
  }, [workspaceInviteCode]);

  // 파생 요약 값은 여러 카드가 동시에 참조하므로
  // 렌더마다 직접 계산하지 않고 한 곳에서 일관되게 계산한다.
  const summary = useMemo<ProjectSummary>(() => {
    const now = new Date();
    const totalCount = tasks.length;
    const todayTaskCount = tasks.filter((task) => {
      const effectiveDueAt = getEffectiveDueAt(task);
      if (task.status === "done" || !effectiveDueAt) {
        return false;
      }

      const dueDate = new Date(effectiveDueAt);
      return (
        dueDate.getFullYear() === now.getFullYear() &&
        dueDate.getMonth() === now.getMonth() &&
        dueDate.getDate() === now.getDate()
      );
    }).length;
    const todoCount = tasks.filter((task) => task.status === "todo").length;
    const inProgressCount = tasks.filter((task) => task.status === "inProgress").length;
    const doneCount = tasks.filter((task) => task.status === "done").length;
    const overdueCount = tasks.filter((task) => {
      const effectiveDueAt = getEffectiveDueAt(task);
      if (task.status === "done" || !effectiveDueAt) {
        return false;
      }

      return new Date(effectiveDueAt).getTime() < now.getTime();
    }).length;
    const unassignedCount = tasks.filter((task) => task.assigneeId === null).length;
    const progress = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);
    const urgentTask =
      tasks.find(
        (task) =>
          task.status !== "done" &&
          getEffectiveDueAt(task) &&
          new Date(getEffectiveDueAt(task) as string).getTime() < now.getTime(),
      ) ??
      tasks.find((task) => task.status !== "done" && task.assigneeId === null) ??
      tasks.find((task) => task.status !== "done");

    let healthScore = 100;
    healthScore -= overdueCount * 15;
    healthScore -= unassignedCount * 10;
    if (progress < 40) {
      healthScore -= 20;
    }
    healthScore = Math.max(0, Math.min(100, healthScore));

    let healthStatus: HealthStatus = "safe";
    if (healthScore < 50) {
      healthStatus = "risk";
    } else if (healthScore < 80) {
      healthStatus = "warning";
    }

    let briefing = "";
    if (overdueCount > 0) {
      briefing = `연체 업무가 ${overdueCount}개 있어요. 오늘 우선순위를 다시 정리해 주세요.`;
    } else if (unassignedCount > 0) {
      briefing = `담당자 미정 업무가 ${unassignedCount}개 있어요. 자동 재분배로 먼저 정리해 주세요.`;
    } else if (progress < 40) {
      briefing = "완료율이 아직 낮아요. 진행 중인 업무를 먼저 끝내면 팀 상태가 빠르게 안정됩니다.";
    } else {
      const briefingMap: Record<HealthStatus, string> = {
        safe: "좋아요. 현재 업무 진행이 안정적이에요. 남은 발표 흐름만 마무리하면 됩니다.",
        warning: "주의 단계예요. 진행 중인 업무를 하나만 더 끝내도 전체 흐름이 훨씬 안정돼요.",
        risk: "위험 단계예요. 연체나 미배정 업무부터 먼저 정리해야 발표 준비가 무너지지 않아요.",
      };
      briefing = briefingMap[healthStatus];
    }

    return {
      totalCount,
      todayTaskCount,
      todoCount,
      inProgressCount,
      doneCount,
      overdueCount,
      unassignedCount,
      urgentTask,
      progress,
      healthScore,
      healthStatus,
      briefing,
    };
  }, [tasks]);

  const todayMeetings = confirmedMeetings.filter(
    (meeting) => meeting.dateLabel === "오늘",
  );
  const upcomingMeetings = confirmedMeetings.filter(
    (meeting) => meeting.dateLabel !== "오늘",
  );
  const hasUnassignedTasks = summary.unassignedCount > 0;

  // 데모 진입/초대 링크/초대 코드/QR 스캔이 모두 같은 결과를 만들도록
  // workspace 초기화 로직을 한 함수로 모아 중복을 방지한다.
  const loadDemoWorkspace = () => {
    const demo = getDemoWorkspace();
    setProject(demo.project);
    setMembers(demo.members);
    setTasks(demo.tasks);
    setScheduleSlots(demo.scheduleSlots);
    setConfirmedMeetings(demo.meetings);
    setFiles(demo.files);
    setActiveTab("home");
    setViewMode("workspace");
    setOnboardingSheetMode(null);
    setSheetMode(null);
    setInviteError("");
    setCopyFeedback("");
    setTeamSaveMessage("");
    setTaskSyncMessage("");
    setMemberSyncMessage("");
    setMeetingSyncMessage("");
    setFileSyncMessage("");
    setMemberLinkMessage("");
    setIsInviteModalOpen(false);
    setIsMemberLinkSheetOpen(false);
    setUnlinkedMemberRows([]);
    setCurrentMember(null);
    setPendingMemberExitId(null);
    setActiveMeetingId(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LAST_TEAM_ID_STORAGE_KEY);
    }
  };

  const loadWorkspaceFromTeamId = useCallback(async (options: {
    source: "card" | "restore" | "invite";
    teamId: string;
    memberRow?: TeamMemberRow | null;
  }) => {
    setIsWorkspaceLoading(true);
    setWorkspaceLoadMessage(
      options.source === "restore"
        ? "마지막 팀을 복원하는 중입니다."
        : "팀 데이터를 불러오는 중입니다.",
    );
    setTaskSyncMessage("실제 팀 업무를 불러오는 중입니다.");
    setMemberSyncMessage("실제 팀원 정보를 불러오는 중입니다.");
    setMeetingSyncMessage("실제 팀 회의를 불러오는 중입니다.");

    const [teamResult, teamMembersResult, tasksResult, meetingsResult, notesResult, filesResult] =
      await Promise.all([
        getTeamById(options.teamId),
        getTeamMembersByTeam(options.teamId),
        getTasksByTeam(options.teamId),
        getMeetingsByTeam(options.teamId),
        getMeetingNotesByTeam(options.teamId),
        getTeamFiles(options.teamId),
      ]);

    if (!teamResult.ok || !teamResult.data) {
      const message = teamResult.ok
        ? "해당 팀을 찾을 수 없습니다."
        : teamResult.message;
      if (options.source === "restore") {
        console.error("Workspace restore team load failed.", {
          savedTeamId: options.teamId,
          userId: authenticatedUser?.id ?? null,
          membershipError: null,
          teamLoadError: message,
        });
      }
      setWorkspaceLoadMessage(message);
      setInviteError(message);
      if (options.source === "restore" && typeof window !== "undefined") {
        window.localStorage.removeItem(LAST_TEAM_ID_STORAGE_KEY);
      }
      setIsWorkspaceLoading(false);
      return false;
    }

    const mappedMembers =
      teamMembersResult.ok && teamMembersResult.data
        ? mapTeamMemberRowsToTeamMembers(teamMembersResult.data)
        : [];
    const currentMemberRow =
      options.memberRow ??
      (authenticatedUser?.id && teamMembersResult.ok && teamMembersResult.data
        ? teamMembersResult.data.find(
            (member) => member.profile_id === authenticatedUser.id,
          ) ?? null
        : null);

    if (options.source === "restore" && !currentMemberRow) {
      const message = "마지막 팀 복원에 실패했습니다. 현재 계정의 팀 멤버십을 확인해 주세요.";
      console.error("Workspace restore current member missing.", {
        savedTeamId: options.teamId,
        userId: authenticatedUser?.id ?? null,
        membershipError: message,
      });
      setWorkspaceLoadMessage(message);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(LAST_TEAM_ID_STORAGE_KEY);
      }
      setIsWorkspaceLoading(false);
      return false;
    }
    const savedTab =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LAST_TAB_STORAGE_KEY)
        : null;
    const restoredTab: TabId =
      savedTab === "tasks" || savedTab === "schedule" || savedTab === "files"
        ? savedTab
        : "home";

    setProject(mapTeamRowToProject(teamResult.data));
    setMembers(mappedMembers);
    setTasks(
      tasksResult.ok && tasksResult.data ? mapTaskRowsToTasks(tasksResult.data) : [],
    );
    const mappedMeetings =
      meetingsResult.ok && meetingsResult.data
        ? mapMeetingRowsToConfirmedMeetings(meetingsResult.data)
        : [];
    const mappedNotes =
      notesResult.ok && notesResult.data
        ? notesResult.data.map(mapMeetingNoteRowToMeetingNote)
        : [];
    setConfirmedMeetings(mergeMeetingsWithNotes(mappedMeetings, mappedNotes));
    setScheduleSlots([]);
    setFiles(
      filesResult.ok && filesResult.data
        ? mapTeamFileRecordsToFileItems(filesResult.data, mappedMembers)
        : [],
    );
    setCurrentMember(
      currentMemberRow ? mapTeamMemberRowsToTeamMembers([currentMemberRow])[0] : null,
    );
    setActiveTab(options.source === "restore" ? restoredTab : "home");
    setViewMode("workspace");
    setOnboardingSheetMode(null);
    setSheetMode(null);
    setIsInviteModalOpen(false);
    setInviteError("");
    setCopyFeedback("");
    setMemberLinkMessage("");
    setPendingMemberExitId(null);
    setActiveMeetingId(null);
    setTaskSyncMessage(tasksResult.ok ? "" : tasksResult.message);
    setMemberSyncMessage(teamMembersResult.ok ? "" : teamMembersResult.message);
    setMeetingSyncMessage(
      meetingsResult.ok
        ? notesResult.ok
          ? ""
          : notesResult.message
        : meetingsResult.message,
    );
    setFileSyncMessage(filesResult.ok ? "" : filesResult.message);
    if (!filesResult.ok) {
      console.error(filesResult.message);
    }
    setWorkspaceLoadMessage("");
    setIsWorkspaceLoading(false);
    setIsRestoringWorkspace(false);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_TEAM_ID_STORAGE_KEY, options.teamId);
      window.localStorage.setItem(
        LAST_TAB_STORAGE_KEY,
        options.source === "restore" ? restoredTab : "home",
      );
    }

    return true;
  }, [authenticatedUser?.id]);

  loadWorkspaceFromTeamIdRef.current = loadWorkspaceFromTeamId;

  const openAuthSheet = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthMessage("");
    setIsAuthSheetOpen(true);
  };

  const closeAuthSheet = () => {
    if (isAuthSubmitting) {
      return;
    }

    setIsAuthSheetOpen(false);
  };

  const closeInviteModal = () => {
    setIsInviteModalOpen(false);
  };

  const openInviteModal = () => {
    setCopyFeedback("");
    setIsInviteModalOpen(true);
  };

  const openFileCreateDialog = () => {
    setFileCreateDialogRequestId((current) => current + 1);
  };

  const closeWorkspaceMenu = () => {
    setIsMenuOpen(false);
  };

  const requestTeamAction = (
    kind: "leave" | "delete",
    summary: ProfileTeamSummary | null,
  ) => {
    if (!summary) {
      return;
    }

    closeWorkspaceMenu();
    setPendingTeamAction({ kind, summary });
  };

  const handleCopyInviteInfo = async () => {
    if (!inviteCode || !inviteLink) {
      setCopyFeedback("초대 정보를 아직 만들지 못했어요.");
      return;
    }

    const payload = `초대 코드: ${inviteCode}\n초대 링크: ${inviteLink}`;

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setCopyFeedback("초대 정보 복사 완료!");
        return;
      }
    } catch {
      // Clipboard API can fail depending on browser permissions.
    }

    setCopyFeedback(payload);
  };

  const handleSignIn = async (input: { email: string; password: string }) => {
    setIsAuthSubmitting(true);
    const result = await signInWithEmail(input);
    setIsAuthSubmitting(false);
    setAuthMessage(result.message);

    if (!result.ok) {
      return false;
    }

    setSession(result.session);
    setUser(result.user);
    setIsAuthSheetOpen(false);
    return true;
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
      return false;
    }

    setSession(result.session);
    setUser(result.user);

    if (!result.needsEmailConfirmation) {
      setIsAuthSheetOpen(false);
    }

    return true;
  };

  const handleSignOut = async () => {
    const result = await signOut();
    setAuthMessage(result.message);

    if (!result.ok) {
      console.error(result.message);
      return;
    }

    setSession(null);
    setUser(null);
    setCurrentMember(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LAST_TEAM_ID_STORAGE_KEY);
    }
  };

  const openMemberLinkSheet = async () => {
    if (!authenticatedUser?.id || !hasPersistentProjectId) {
      setMemberLinkMessage("로그인된 실제 팀에서만 팀원 연결을 진행할 수 있어요.");
      return;
    }

    setIsMemberLinkLoading(true);
    const result = await getUnlinkedTeamMembersByTeam(project.id);
    setIsMemberLinkLoading(false);

    if (!result.ok || !result.data) {
      console.error(result.message);
      setMemberLinkMessage(result.message);
      return;
    }

    setUnlinkedMemberRows(result.data);
    setMemberLinkMessage("");
    setIsMemberLinkSheetOpen(true);
  };

  const closeMemberLinkSheet = () => {
    if (isMemberLinkLoading) {
      return;
    }

    setIsMemberLinkSheetOpen(false);
  };

  const handleClaimMember = async (memberId: string) => {
    if (!authenticatedUser?.id || !hasPersistentProjectId) {
      return;
    }

    setIsMemberLinkLoading(true);
    const result = await connectProfileToTeamMember({
      teamId: project.id,
      memberId,
      profileId: authenticatedUser.id,
    });
    setIsMemberLinkLoading(false);

    if (!result.ok || !result.data) {
      console.error(result.message);
      setMemberLinkMessage(result.message);
      return;
    }

    const mappedMember = mapTeamMemberRowsToTeamMembers([result.data])[0];
    setCurrentMember(mappedMember);
    setMembers((current) =>
      current.map((member) => (member.id === mappedMember.id ? mappedMember : member)),
    );
    setUnlinkedMemberRows((current) => current.filter((member) => member.id !== memberId));
    setMemberLinkMessage("내 팀원 정보 연결이 완료되었습니다.");
    setIsMemberLinkSheetOpen(false);
  };

  const handleCreateLinkedMember = async () => {
    if (!authenticatedUser?.id || !hasPersistentProjectId) {
      return;
    }

    const joiningName = userNickname || authenticatedUser.email?.split("@")[0] || "팀원";
    setIsMemberLinkLoading(true);
    const result = await createAndLinkTeamMember({
      teamId: project.id,
      profileId: authenticatedUser.id,
      name: joiningName,
      role: "팀원",
      skillTag: SKILL_POOL[0],
    });
    setIsMemberLinkLoading(false);

    if (!result.ok || !result.data) {
      console.error(result.message);
      setMemberLinkMessage(result.message);
      return;
    }

    const mappedMember = mapTeamMemberRowsToTeamMembers([result.data])[0];
    setCurrentMember(mappedMember);
    setMembers((current) => [...current, mappedMember]);
    setMemberLinkMessage("새 팀원으로 참여 연결이 완료되었습니다.");
    setIsMemberLinkSheetOpen(false);
  };

  const createWorkspaceFromForm = async (input: {
    teamName: string;
    courseName: string;
    memberNames: string;
    description: string;
    startDate: string;
    endDate: string;
  }) => {
    const deadlineLabel = formatDeadlineLabel(input.endDate);
    const generatedInviteCode = generateInviteCode();
    const creatorName =
      authenticatedUser && (userNickname || authenticatedUser.email?.split("@")[0])
        ? userNickname || authenticatedUser.email?.split("@")[0] || "팀장"
        : null;

    // 새 팀 생성은 백엔드가 없는 MVP이므로
    // 입력값을 현재 화면 상태에 즉시 반영하는 방식으로 시뮬레이션한다.
    const inputNames = input.memberNames
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const inviteeNames = creatorName
      ? dedupeMemberNames(
          inputNames.filter(
            (name) => normalizeMemberNameKey(name) !== normalizeMemberNameKey(creatorName),
          ),
        )
      : dedupeMemberNames(inputNames);

    const allMemberNames = creatorName
      ? [creatorName, ...inviteeNames]
      : inviteeNames.length > 0
        ? inviteeNames
        : ["팀장"];

    const nextMembers: TeamMember[] = allMemberNames.map((name, index) => ({
      id: `member-${Date.now()}-${index}`,
      name,
      role: index === 0 ? ROLE_POOL[0] : ROLE_POOL[(index % (ROLE_POOL.length - 1)) + 1],
      skillTag: SKILL_POOL[index % SKILL_POOL.length],
      isLeader: index === 0,
      availability: DEFAULT_AVAILABILITY,
      status: "active" as const,
    }));

    const teamMemberSeeds: CreateTeamMemberSeed[] = creatorName
      ? [
          {
            profileId: authenticatedUser?.id ?? null,
            name: creatorName,
            role: "팀장 / 발표 정리",
            skillTag: SKILL_POOL[0],
            isLeader: true,
            status: "active",
          },
          ...inviteeNames.map((name, index) => ({
            profileId: null,
            name,
            role: "팀원",
            skillTag: SKILL_POOL[(index + 1) % SKILL_POOL.length],
            isLeader: false,
            status: "active",
          })),
        ]
      : allMemberNames.map((name, index) => ({
          profileId: null,
          name,
          role: index === 0 ? "팀장 / 발표 정리" : "팀원",
          skillTag: SKILL_POOL[index % SKILL_POOL.length],
          isLeader: index === 0,
          status: "active",
        }));

    const [leader, secondMember, thirdMember] = nextMembers;
    const nextProject: Project = {
      id: `project-${Date.now()}`,
      name: input.teamName,
      courseName: input.courseName,
      deadlineLabel,
      inviteCode: generatedInviteCode,
      description: input.description.trim() || undefined,
      startDate: input.startDate.trim() || undefined,
      endDate: input.endDate.trim() || undefined,
    };

    let starterTasks: Task[] = [
      {
        id: `task-${Date.now()}-0`,
        title: "역할 분담 먼저 정리하기",
        assigneeId: leader?.id ?? null,
        status: "todo",
        priority: "high",
        dueLabel: "오늘",
        dueAt: getTaskDueAt(0, 18),
        aiSuggestedRole: "팀장이 먼저 정리하면 팀 흐름이 빨라져요.",
      },
      {
        id: `task-${Date.now()}-1`,
        title: "과제 요구사항 한 줄로 요약하기",
        assigneeId: secondMember?.id ?? leader?.id ?? null,
        status: "inProgress",
        priority: "medium",
        dueLabel: "오늘",
        dueAt: getTaskDueAt(0, 20),
        aiSuggestedRole: "정리형 팀원이 맡으면 좋아요.",
      },
      {
        id: `task-${Date.now()}-2`,
        title: "발표용 자료 폴더 만들기",
        assigneeId: thirdMember?.id ?? leader?.id ?? null,
        status: "todo",
        priority: "medium",
        dueLabel: "내일",
        dueAt: getTaskDueAt(1, 15),
      },
    ];

    const saveResult = await saveTeamToSupabase({
      teamName: input.teamName.trim(),
      courseName: input.courseName.trim(),
      inviteCode: generatedInviteCode,
      deadlineLabel,
      memberNames: allMemberNames,
      description: input.description,
      startDate: input.startDate,
      endDate: input.endDate,
    });

    if (!saveResult.ok) {
      setTeamSaveMessage(saveResult.message);
      return false;
    }

    let createdMembers = nextMembers;
    let nextSaveMessage = saveResult.message;

    if (saveResult.team?.id) {
      const memberCreateResult = await createTeamMembers(
        saveResult.team.id,
        teamMemberSeeds,
      );

      if (!memberCreateResult.ok || !memberCreateResult.data) {
        console.error(memberCreateResult.message);
        setMemberSyncMessage(memberCreateResult.message);
        nextSaveMessage = `${saveResult.message} team_members 생성은 실패했습니다.`;
      } else {
        createdMembers = mapTeamMemberRowsToTeamMembers(memberCreateResult.data);
        starterTasks = starterTasks.map((task, index) => ({
          ...task,
          assigneeId: createdMembers[Math.min(index, createdMembers.length - 1)]?.id ?? null,
        }));
        setCurrentMember(
          authenticatedUser?.id
            ? createdMembers.find((member) => member.isLeader) ?? null
            : null,
        );
        setMemberSyncMessage("");
      }
    }

    setProject({
      ...nextProject,
      id: saveResult.team?.id ?? nextProject.id,
      inviteCode: saveResult.team?.invite_code ?? generatedInviteCode,
    });
    setMembers(createdMembers);
    setTasks(starterTasks);
    setScheduleSlots([]);
    setConfirmedMeetings([]);
    setFiles([]);
    setFileSyncMessage("");
    setActiveTab("home");
    setViewMode("onboarding");
    setOnboardingSheetMode("shareInvite");
    setInviteError("");
    setCopyFeedback("");
    setTeamSaveMessage(nextSaveMessage);
    setTaskSyncMessage("");
    return true;
  };

  const handleJoinWithCode = (code: string) => {
    const normalizedCode = normalizeInviteCode(code);

    if (normalizedCode === DEMO_INVITE_CODE) {
      loadDemoWorkspace();
      return true;
    }

    if (!normalizedCode) {
      setInviteError("초대 코드를 입력해 주세요.");
      return false;
    }

    setInviteError("");
    void router.push(`/join/${normalizedCode}`);
    return false;
  };

  const openSheet = (
    mode: WorkspaceSheetMode,
    options?: {
      meetingPreset?: MeetingDraftInput | null;
    },
  ) => {
    if (mode === "meeting") {
      setMeetingDraftPreset(options?.meetingPreset ?? null);
    }

    setSheetMode(mode);
  };
  const closeSheet = () => {
    setSheetMode(null);
    setMeetingDraftPreset(null);
  };

  const handleAddTask = (title: string) => {
    // 새 업무 추가 시 현재 active 멤버 중 한 명에게 바로 배정해
    // 홈/업무 탭이 즉시 연결되어 보이도록 한다.
    const assignee = activeMembers[tasks.length % Math.max(activeMembers.length, 1)];
    const dueAt = getTaskDueAt(0, 18);
    const nextTask: Task = {
      id: `task-${Date.now()}`,
      title,
      assigneeId: assignee?.id ?? null,
      status: "todo",
      priority: "medium",
      dueLabel: "오늘",
      dueAt,
      aiSuggestedRole: assignee
        ? `${assignee.name}(${assignee.skillTag})에게 추천`
        : "담당자를 정해 주세요.",
    };

    setTasks((current) => [nextTask, ...current]);
    setActiveTab("tasks");
    closeSheet();

    if (!hasPersistentProjectId || isTaskCreating) {
      return;
    }

    setIsTaskCreating(true);

    void (async () => {
      const result = await createTask({
        teamId: project.id,
        title,
        description: nextTask.description,
        assigneeId: assignee?.id && isUuid(assignee.id) ? assignee.id : null,
        status: "todo",
        priority: "medium",
        dueAt,
        aiSuggestedRole: nextTask.aiSuggestedRole,
      });

      setIsTaskCreating(false);

      if (!result.ok || !result.data) {
        console.error(result.message);
        setTaskSyncMessage(result.message);
        return;
      }

      const [persistedTask] = mapTaskRowsToTasks([result.data]);
      setTasks((current) =>
        current.map((task) =>
          task.id === nextTask.id
            ? {
                ...persistedTask,
                assigneeId: nextTask.assigneeId,
              }
            : task,
        ),
      );
      setTaskSyncMessage("");
    })();
  };

  const handleAdvanceTask = (taskId: string) => {
    // 업무 카드를 탭할 때마다 To Do -> In Progress -> Done 순으로 순환한다.
    if (pendingTaskIds.includes(taskId)) {
      return;
    }

    const currentTask = tasks.find((task) => task.id === taskId);
    if (!currentTask) {
      return;
    }

    const nextStatusMap: Record<TaskStatus, TaskStatus> = {
      todo: "inProgress",
      inProgress: "done",
      done: "todo",
    };

    const nextStatus = nextStatusMap[currentTask.status];
    const optimisticTask: Task = {
      ...currentTask,
      status: nextStatus,
      completedAt: nextStatus === "done" ? new Date().toISOString() : null,
      dueLabel: formatTaskDueLabel(currentTask.dueAt, nextStatus === "done" ? new Date().toISOString() : null),
    };

    setTasks((current) =>
      current.map((task) => (task.id === taskId ? optimisticTask : task)),
    );

    if (!hasPersistentProjectId || !isUuid(taskId)) {
      return;
    }

    setPendingTaskIds((current) => [...current, taskId]);

    void (async () => {
      const result = await updateTaskFields(taskId, { status: nextStatus });

      setPendingTaskIds((current) => current.filter((id) => id !== taskId));

      if (!result.ok || !result.data) {
        console.error(result.message);
        setTaskSyncMessage(result.message);
        setTasks((current) =>
          current.map((task) => (task.id === taskId ? currentTask : task)),
        );
        return;
      }

      const [persistedTask] = mapTaskRowsToTasks([result.data]);
      setTasks((current) =>
        current.map((task) =>
          task.id === taskId
            ? {
                ...persistedTask,
                assigneeId: currentTask.assigneeId,
              }
            : task,
        ),
      );
      setTaskSyncMessage("");
    })();
  };

  const handleAddSchedule = (title: string) => {
    // 일정 추가는 추천 슬롯 목록에 바로 삽입해
    // "추가 후 확정" 흐름을 짧게 시연할 수 있도록 구성한다.
    const nextSlot: ScheduleSlot = {
      id: `slot-${Date.now()}`,
      label: title,
      dateLabel: "7월 11일 토요일",
      timeRange: "16:00 - 16:30",
      memberIds: activeMembers.slice(0, 3).map((member) => member.id),
      recommended: false,
    };

    setScheduleSlots((current) => [nextSlot, ...current]);
    setActiveTab("schedule");
    closeSheet();
  };

  const handleCreateMeeting = async (input: {
    title: string;
    startsAt: string;
    endsAt: string;
    agenda: string;
  }) => {
    const trimmedTitle = input.title.trim();
    const startsAtInput = input.startsAt.trim();
    const endsAtInput = input.endsAt.trim();
    const trimmedAgenda = input.agenda.trim();

    if (!trimmedTitle || !startsAtInput) {
      setMeetingSyncMessage("회의 제목과 시작 시각을 입력해 주세요.");
      return false;
    }

    const startsAtDate = new Date(startsAtInput);
    const endsAtDate = endsAtInput ? new Date(endsAtInput) : null;

    if (
      Number.isNaN(startsAtDate.getTime()) ||
      (endsAtDate && Number.isNaN(endsAtDate.getTime()))
    ) {
      setMeetingSyncMessage("회의 시각 형식이 올바르지 않습니다.");
      return false;
    }

    const startsAt = startsAtDate.toISOString();
    const endsAt = endsAtDate ? endsAtDate.toISOString() : "";

    const nextMeeting: ConfirmedMeeting = {
      id: `meeting-${Date.now()}`,
      title: trimmedTitle,
      dateLabel: formatMeetingDateLabel(startsAt),
      timeRange: formatMeetingTimeRange(startsAt, endsAt || null),
      attendeeCount: activeMembers.length,
      status: getMeetingStatus({
        startsAt,
        endsAt: endsAt || null,
      }),
      createdByMemberId: currentMember?.id ?? null,
      startsAt,
      endsAt: endsAt || null,
      agenda: trimmedAgenda || null,
      teamId: hasPersistentProjectId ? project.id : undefined,
      isEnded: getMeetingStatus({
        startsAt,
        endsAt: endsAt || null,
      }) === "ended",
    };

    if (!hasPersistentProjectId) {
      setConfirmedMeetings((current) => [nextMeeting, ...current]);
      setMeetingSyncMessage("데모 회의를 로컬 상태에 추가했습니다.");
      setActiveTab("schedule");
      closeSheet();
      return true;
    }

    const result = await createMeeting({
      teamId: project.id,
      title: trimmedTitle,
      startsAt,
      endsAt: endsAt || null,
      createdBy: currentMember?.id ?? null,
    });

    if (!result.ok || !result.data) {
      setMeetingSyncMessage(result.message);
      return false;
    }

    const persistedMeeting = mapMeetingRowsToConfirmedMeetings([result.data])[0];
    let nextPersistedMeeting: ConfirmedMeeting = {
      ...persistedMeeting,
      agenda: trimmedAgenda || null,
    };

    if (trimmedAgenda) {
      const noteResult = await createMeetingNote({
        teamId: project.id,
        meetingId: result.data.id,
        title: `${trimmedTitle} 회의록`,
        content: serializeMeetingNoteContent({
          transcript: "",
          agenda: trimmedAgenda,
          pinnedMessages: [],
          aiUnresolvedItems: [],
        }),
        aiSummary: null,
        aiDecisions: [],
        aiActionItems: [],
      });

      if (noteResult.ok && noteResult.data) {
        const savedNote = mapMeetingNoteRowToMeetingNote(noteResult.data);
        nextPersistedMeeting = {
          ...nextPersistedMeeting,
          agenda: savedNote.agenda,
          noteId: savedNote.id,
          pinnedMessages: savedNote.pinnedMessages,
        };
      }
    }

    setConfirmedMeetings((current) => [nextPersistedMeeting, ...current]);
    setMeetingSyncMessage("");
    setActiveTab("schedule");
    closeSheet();
    return true;
  };

  const handleConfirmSlot = (slotId: string) => {
    // 추천 슬롯을 확정 일정으로 이동시키는 상태 전환 로직이다.
    const selectedSlot = scheduleSlots.find((slot) => slot.id === slotId);
    if (!selectedSlot) {
      return;
    }

    const nextMeeting: ConfirmedMeeting = {
      id: `meeting-${Date.now()}`,
      title: selectedSlot.label,
      dateLabel: selectedSlot.dateLabel,
      timeRange: selectedSlot.timeRange,
      attendeeCount: selectedSlot.memberIds.length,
      status: "inProgress",
      createdByMemberId: activeMembers[0]?.id ?? null,
      isEnded: false,
    };

    const startsAt = new Date().toISOString();

    if (!hasPersistentProjectId) {
      setConfirmedMeetings((current) => [nextMeeting, ...current]);
      setScheduleSlots((current) => current.filter((slot) => slot.id !== slotId));
      setActiveTab("schedule");
      return;
    }

    void (async () => {
      const result = await createMeeting({
        teamId: project.id,
        title: selectedSlot.label,
        startsAt,
        endsAt: null,
        createdBy: currentMember?.id ?? null,
      });

      if (!result.ok || !result.data) {
        setMeetingSyncMessage(result.message);
        return;
      }

      const persistedMeeting = mapMeetingRowsToConfirmedMeetings([result.data])[0];
      setConfirmedMeetings((current) => [persistedMeeting, ...current]);
      setScheduleSlots((current) => current.filter((slot) => slot.id !== slotId));
      setMeetingSyncMessage("");
      setActiveTab("schedule");
    })();
  };

  const reloadTeamFiles = async (successMessage?: string) => {
    const reloadResult = await getTeamFiles(project.id);
    if (reloadResult.ok && reloadResult.data) {
      setFiles(mapTeamFileRecordsToFileItems(reloadResult.data, membersRef.current));
      setFileSyncMessage(successMessage ?? "");
      return true;
    }

    if (!reloadResult.ok) {
      setFileSyncMessage(reloadResult.message);
    }

    return false;
  };

  const handleUploadTeamFile = async (
    file: File,
    category: FileItem["category"],
    onProgress: (percent: number) => void,
  ) => {
    if (!hasPersistentProjectId || !currentMember) {
      return {
        ok: false,
        message: "실제 UUID 팀에서만 파일 업로드를 사용할 수 있습니다.",
      };
    }

    const result = await uploadTeamFile(
      {
        teamId: project.id,
        uploadedBy: currentMember.id,
        file,
        category,
      },
      onProgress,
    );

    if (!result.ok) {
      return result;
    }

    await reloadTeamFiles(`${file.name} 업로드가 완료되었습니다.`);

    return {
      ok: true,
      message: `${file.name} 업로드가 완료되었습니다.`,
    };
  };

  const handleCreateLinkResource = async (input: {
    title: string;
    url: string;
    category: FileItem["category"];
    note?: string;
  }) => {
    if (!hasPersistentProjectId || !currentMember) {
      return {
        ok: false,
        message: "실제 UUID 팀에서만 링크 등록을 사용할 수 있습니다.",
      };
    }

    const result = await createTeamLinkResource({
      teamId: project.id,
      uploadedBy: currentMember.id,
      title: input.title,
      url: input.url,
      category: input.category,
      note: input.note,
    });

    if (!result.ok) {
      return result;
    }

    await reloadTeamFiles("링크가 등록되었습니다.");

    return {
      ok: true,
      message: "링크가 등록되었습니다.",
    };
  };

  const handleUpdateResource = async (
    file: FileItem,
    input: {
      title: string;
      category: FileItem["category"];
      url?: string;
      note?: string;
    },
  ) => {
    if (!hasPersistentProjectId || !currentMember) {
      return {
        ok: false,
        message: "실제 UUID 팀에서만 자료를 수정할 수 있습니다.",
      };
    }

    if (!file.sharedFileId) {
      return {
        ok: false,
        message: "수정할 자료 정보를 찾을 수 없습니다.",
      };
    }

    const result = await updateTeamResource(file.sharedFileId, {
      title: input.title,
      category: input.category,
      url: input.url,
      note: input.note,
    });

    if (!result.ok) {
      return result;
    }

    await reloadTeamFiles("자료가 수정되었습니다.");

    return {
      ok: true,
      message: "자료가 수정되었습니다.",
    };
  };

  const handleDeleteResource = async (file: FileItem) => {
    if (!hasPersistentProjectId || !currentMember) {
      return {
        ok: false,
        message: "실제 UUID 팀에서만 자료를 삭제할 수 있습니다.",
      };
    }

    if (!file.sharedFileId) {
      return {
        ok: false,
        message: "삭제할 자료 정보를 찾을 수 없습니다.",
      };
    }

    const result = await deleteTeamResource(file.sharedFileId);
    if (!result.ok) {
      return result;
    }

    await reloadTeamFiles("자료가 삭제되었습니다.");

    return {
      ok: true,
      message: "자료가 삭제되었습니다.",
    };
  };

  const handleDownloadTeamFile = async (file: FileItem) => {
    if (!hasPersistentProjectId || !file.storagePath || file.resourceType === "link") {
      return {
        ok: false,
        message: "파일 다운로드만 지원됩니다.",
      };
    }

    const result = await getTeamFileSignedUrl(file.storagePath);
    if (!result.ok || !result.data) {
      return result;
    }

    if (typeof window !== "undefined") {
      window.open(result.data, "_blank", "noopener,noreferrer");
    }

    return {
      ok: true,
      message: "다운로드 링크를 열었습니다.",
    };
  };

  const handleOpenTeamLink = async (file: FileItem) => {
    const url = file.resourceUrl ?? file.storagePath ?? "";
    if (!url || !/^https?:\/\//i.test(url)) {
      return {
        ok: false,
        message: "열 수 있는 링크가 없습니다.",
      };
    }

    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }

    return {
      ok: true,
      message: "링크를 새 탭에서 열었습니다.",
    };
  };

  const removeLastVisitedTeamId = (teamId: string) => {
    if (typeof window === "undefined") {
      return;
    }

    if (window.localStorage.getItem(LAST_TEAM_ID_STORAGE_KEY) === teamId) {
      window.localStorage.removeItem(LAST_TEAM_ID_STORAGE_KEY);
    }
  };

  const handleLeaveTeam = async (summary: ProfileTeamSummary) => {
    const result = await deleteTeamMember(summary.member.id);
    if (!result.ok) {
      return result;
    }

    setMyTeams((current) => current.filter((item) => item.member.id !== summary.member.id));
    setMyTeamsMessage("팀에서 나갔습니다.");
    removeLastVisitedTeamId(summary.team.id);
    if (project.id === summary.team.id) {
      setCurrentMember(null);
      setViewMode("onboarding");
      setActiveTab("home");
    }

    return {
      ok: true,
      message: "팀에서 나갔습니다.",
    };
  };

  const handleDeleteTeam = async (summary: ProfileTeamSummary) => {
    if (!session?.access_token) {
      return {
        ok: false,
        message: "로그인 세션을 확인할 수 없습니다.",
      };
    }

    const response = await fetch(`/api/teams/${encodeURIComponent(summary.team.id)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      let message = "팀 삭제에 실패했습니다.";
      try {
        const payload = (await response.json()) as { error?: string };
        message = payload.error ?? message;
      } catch {
        // keep fallback message
      }

      return {
        ok: false,
        message,
      };
    }

    setMyTeams((current) => current.filter((item) => item.team.id !== summary.team.id));
    setMyTeamsMessage("팀이 삭제되었습니다.");
    removeLastVisitedTeamId(summary.team.id);
    if (project.id === summary.team.id) {
      setCurrentMember(null);
      setViewMode("onboarding");
      setActiveTab("home");
    }

    return {
      ok: true,
      message: "팀이 삭제되었습니다.",
    };
  };

  const handleMeetingUpdated = (updatedMeeting: ConfirmedMeeting) => {
    setConfirmedMeetings((current) =>
      current.map((meeting) =>
        meeting.id === updatedMeeting.id ? updatedMeeting : meeting,
      ),
    );
  };

  const handleToggleAvailability = (day: number, time: string) => {
    const key = buildAvailabilityKey(day, time);
    if (!key) {
      return;
    }

    setSelectedAvailabilityKeys((current) => {
      const next = current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key];

      return next.sort();
    });
  };

  const handleSaveAvailability = async () => {
    const targetMember = editableAvailabilityMember;
    if (!targetMember) {
      setAvailabilityMessage("공강 시간을 저장하려면 팀원 연결이 필요합니다.");
      return;
    }

    const slots = selectedAvailabilityKeys
      .map((key) => {
        const [day, time] = key.split("|");
        const dayOfWeek = Number(day);
        const normalizedTime = normalizeAvailabilityTime(time ?? "");
        if (Number.isNaN(dayOfWeek) || !normalizedTime) {
          return null;
        }

        return {
          dayOfWeek,
          timeSlot: normalizedTime,
        };
      })
      .filter((slot): slot is { dayOfWeek: number; timeSlot: string } => Boolean(slot));

    if (!hasPersistentProjectId || !currentMember) {
      const nextLabels = slots
        .map((slot) => formatAvailabilityLabel(slot.dayOfWeek, slot.timeSlot))
        .filter(Boolean);

      setMembers((current) =>
        current.map((member) =>
          member.id === targetMember.id
            ? { ...member, availability: nextLabels }
            : member,
        ),
      );
      setAvailabilityMessage("✅ 저장되었습니다.");
      return;
    }

    setAvailabilitySaving(true);
    setAvailabilityMessage("저장 중");
    const result = await replaceMemberAvailability(currentMember.id, slots);
    setAvailabilitySaving(false);

    if (!result.ok) {
      setAvailabilityMessage(result.message);
      return;
    }

    const reloadResult = await getAvailabilityByTeam(project.id);
    if (!reloadResult.ok || !reloadResult.data) {
      setAvailabilityMessage(reloadResult.message);
      return;
    }

    setTeamAvailability(reloadResult.data);
    setAvailabilityMessage("✅ 저장되었습니다.");
  };

  const handleImportMeetingActionItems = async (
    meeting: ConfirmedMeeting,
    items: Array<{ key: string; item: MeetingActionItem }>,
  ) => {
    if (items.length === 0) {
      return {
        ok: false,
        message: "선택한 할 일 후보가 없습니다.",
        imported: [],
        failed: [],
      };
    }

    if (!hasPersistentProjectId) {
      const demoTasks = items.map(({ item }, index) => {
        const assignee = members.find((member) => member.name === item.assigneeName);
        const dueAt = new Date();
        const dueAtIso = item.dueAt ?? dueAt.toISOString();
        const resolvedDueAt = new Date(dueAtIso);
        if (Number.isNaN(resolvedDueAt.getTime())) {
          dueAt.setDate(dueAt.getDate() + item.dueDateOffsetDays);
        }

        return {
          id: `task-${Date.now()}-${index}`,
          title: item.title,
          assigneeId: assignee?.id ?? null,
          status: "todo" as const,
          priority: item.priority ?? ("medium" as const),
          dueLabel: formatTaskDueLabel(
            Number.isNaN(resolvedDueAt.getTime())
              ? dueAt.toISOString()
              : resolvedDueAt.toISOString(),
            null,
          ),
          dueAt: Number.isNaN(resolvedDueAt.getTime())
            ? dueAt.toISOString()
            : resolvedDueAt.toISOString(),
          aiSuggestedRole: "회의 AI 추천 업무",
        };
      });

      setTasks((current) => [...demoTasks, ...current]);
      setActiveTab("tasks");

      return {
        ok: true,
        message: `${demoTasks.length}개의 데모 업무를 Tasks에 추가했습니다.`,
        imported: items.map(({ key }) => ({
          key,
          taskId: null,
        })),
        failed: [],
      };
    }

    const createdTasks: Task[] = [];
    const imported: Array<{ key: string; taskId: string | null }> = [];
    const failed: Array<{ key: string; message: string }> = [];

    for (const { key, item } of items) {
      const assignee = members.find((member) => member.name === item.assigneeName);
      const resolvedDueAt = item.dueAt ? new Date(item.dueAt) : new Date();
      if (Number.isNaN(resolvedDueAt.getTime())) {
        resolvedDueAt.setHours(18, 0, 0, 0);
        resolvedDueAt.setDate(resolvedDueAt.getDate() + item.dueDateOffsetDays);
      }

      const result = await createTask({
        teamId: project.id,
        title: item.title,
        assigneeId: assignee?.id ?? null,
        status: "todo",
        priority: item.priority ?? "medium",
        dueAt: resolvedDueAt.toISOString(),
        aiSuggestedRole: `회의 "${meeting.title}" AI 추천 업무`,
      });

      if (!result.ok || !result.data) {
        failed.push({
          key,
          message: result.message,
        });
        continue;
      }

      createdTasks.push(mapTaskRowsToTasks([result.data])[0]);
      imported.push({
        key,
        taskId: result.data.id,
      });
    }

    if (createdTasks.length > 0) {
      setTasks((current) => [...createdTasks, ...current]);
      setTaskSyncMessage("");
      setActiveTab("tasks");
    }

    const message =
      failed.length === 0
        ? `${createdTasks.length}개의 업무를 실제 Tasks 보드에 등록했습니다.`
        : createdTasks.length === 0
          ? `업무 등록에 실패했습니다. ${failed[0]?.message ?? ""}`.trim()
          : `${createdTasks.length}개 등록, ${failed.length}개 실패했습니다. 실패한 항목은 다시 시도해 주세요.`;

    return {
      ok: failed.length === 0 && createdTasks.length > 0,
      message,
      imported,
      failed,
    };
  };

  const handleConfirmMemberExit = () => {
    // 팀원 이탈 승인 시 멤버는 former 상태로 바꾸고,
    // 그 멤버가 맡던 업무는 담당자 미정(null)으로 바꿔 후속 재분배를 유도한다.
    if (!pendingMemberExitId) {
      return;
    }

    setMembers((current) =>
      current.map((member) =>
        member.id === pendingMemberExitId ? { ...member, status: "former" } : member,
      ),
    );
    setTasks((current) =>
      current.map((task) =>
        task.assigneeId === pendingMemberExitId
          ? {
              ...task,
              assigneeId: null,
              aiSuggestedRole: "담당자 미정 · 자동 재분배가 필요해요.",
            }
          : task,
      ),
    );
    setPendingMemberExitId(null);
    setActiveTab("tasks");
  };

  const handleAutoRedistribute = () => {
    // 재분배는 "남아 있는 active 멤버 중 미완료 업무가 가장 적은 사람"에게 배정한다.
    // 발표용 MVP에서는 단순한 규칙이 동작 설명에 가장 유리하다.
    const availableMembers = activeMembers;
    if (availableMembers.length === 0) {
      return;
    }

    const getOpenTaskLoad = (memberId: string) =>
      tasks.filter(
        (task) =>
          task.assigneeId === memberId &&
          task.status !== "done",
      ).length;

    const bestAssignee = [...availableMembers].sort((left, right) => {
      const loadGap = getOpenTaskLoad(left.id) - getOpenTaskLoad(right.id);
      if (loadGap !== 0) {
        return loadGap;
      }

      return left.id.localeCompare(right.id);
    })[0];

    setTasks((current) =>
      current.map((task) =>
        task.assigneeId === null
          ? {
              ...task,
              assigneeId: bestAssignee.id,
              aiSuggestedRole: `${bestAssignee.name}(${bestAssignee.skillTag})에게 자동 재배정됨`,
            }
          : task,
      ),
    );
    setActiveTab("home");
  };

  const pendingExitMember = members.find(
    (member) => member.id === pendingMemberExitId,
  );
  const activeMeeting =
    confirmedMeetings.find((meeting) => meeting.id === activeMeetingId) ?? null;

  const renderWorkspaceSheet = () => {
    // 현재 탭에 따라 빠른 추가 바텀시트 내용을 바꿔 재사용한다.
    if (!sheetMode) {
      return null;
    }

    if (sheetMode === "task") {
      return (
        <QuickActionSheet
          title="업무 빠르게 추가"
          description="발표 전에 바로 시연할 수 있도록 제목만 입력하면 오늘 업무로 추가됩니다."
          actionLabel="업무 추가"
          placeholder="예: 발표 결론 슬라이드 다듬기"
          onClose={closeSheet}
          onSubmit={handleAddTask}
        />
      );
    }

    if (sheetMode === "schedule") {
      return (
        <QuickActionSheet
          title="일정 빠르게 추가"
          description="간단한 회의 이름만 입력하면 추천 슬롯 목록에 새 일정이 추가됩니다."
          actionLabel="일정 추가"
          placeholder="예: 발표 리허설 점검"
          onClose={closeSheet}
          onSubmit={handleAddSchedule}
        />
      );
    }

    if (sheetMode === "meeting") {
      return (
        <MeetingCreateSheet
          initialValues={meetingDraftPreset}
          onClose={closeSheet}
          onSubmit={handleCreateMeeting}
        />
      );
    }

    return null;
  };

  const renderOnboardingSheet = () => {
    // 온보딩은 참여 방식별 모달이 다르므로
    // 현재 모드에 맞는 시트를 조건부로 렌더링한다.
    if (onboardingSheetMode === "createTeam") {
      return (
        <CreateTeamSheet
          onClose={() => setOnboardingSheetMode(null)}
          onSubmit={createWorkspaceFromForm}
          submitMessage={teamSaveMessage}
          creatorName={authenticatedUser ? userNickname || authenticatedUser.email?.split("@")[0] || "" : ""}
        />
      );
    }

    if (onboardingSheetMode === "joinTeam") {
      return (
        <JoinTeamSheet
          errorMessage={inviteError}
          onClose={() => {
            setOnboardingSheetMode(null);
            setInviteError("");
          }}
          onSubmit={handleJoinWithCode}
        />
      );
    }

    if (onboardingSheetMode === "joinLink") {
      return (
        <InviteLinkModal
          onClose={() => setOnboardingSheetMode(null)}
          onConfirm={() => {
            void router.push(`/join/${DEMO_INVITE_CODE}`);
          }}
        />
      );
    }

    if (onboardingSheetMode === "joinQr") {
      return (
        <QrScannerModal
          onClose={() => setOnboardingSheetMode(null)}
          onScanSuccess={() => {
            void router.push(`/join/${DEMO_INVITE_CODE}`);
          }}
        />
      );
    }

    if (onboardingSheetMode === "shareInvite") {
      return (
        <ShareInviteModal
          copyFeedback={copyFeedback}
          inviteCode={inviteCode || DEMO_INVITE_CODE}
          inviteLink={inviteLink || buildInviteLink(DEMO_INVITE_CODE)}
          noticeMessage={teamSaveMessage}
          onClose={() => {
            setOnboardingSheetMode(null);
            setViewMode("workspace");
            setTeamSaveMessage("");
          }}
          onCopy={() => {
            void handleCopyInviteInfo();
          }}
        />
      );
    }

    return null;
  };

  const renderMemberLinkSheet = () => {
    if (!isMemberLinkSheetOpen) {
      return null;
    }

    return (
      <MemberLinkSheet
        creatorName={userNickname || authenticatedUser?.email?.split("@")[0] || "팀원"}
        isLoading={isMemberLinkLoading}
        members={unlinkedMemberRows}
        message={memberLinkMessage}
        onClose={closeMemberLinkSheet}
        onClaim={handleClaimMember}
        onCreateNew={handleCreateLinkedMember}
      />
    );
  };

  const renderAuthSheet = () => {
    if (!isAuthSheetOpen) {
      return null;
    }

    return (
      <AuthSheet
        mode={authMode}
        message={authMessage}
        isSubmitting={isAuthSubmitting}
        onClose={closeAuthSheet}
        onChangeMode={setAuthMode}
        onSignIn={handleSignIn}
        onSignUp={handleSignUp}
      />
    );
  };

  const renderMyPageModal = () => {
    if (!isMyPageOpen || !authenticatedUser) {
      return null;
    }

    return (
      <ModalShell title="마이페이지" onClose={() => setIsMyPageOpen(false)}>
        <div className="space-y-4">
          <div className="rounded-[22px] border border-line bg-canvas px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand sm:text-sm">
              내 정보
            </p>
            <div className="mt-3 space-y-2 text-sm leading-6 text-ink sm:text-base">
              <p className="break-keep font-semibold">닉네임: {userNickname || "미설정"}</p>
              <p className="break-all text-muted">
                이메일: {authenticatedUser.email || "이메일 정보 없음"}
              </p>
              <p className="font-medium text-muted">
                현재 소속 팀 수: {myTeams.length}개
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsMyPageOpen(false);
              void handleSignOut();
            }}
            className="w-full rounded-2xl bg-brand px-4 py-4 text-sm font-semibold text-white shadow-brand sm:text-base"
          >
            로그아웃
          </button>
        </div>
      </ModalShell>
    );
  };

  if (isSplashVisible) {
    return <SplashScreen />;
  }

  if (isRestoringWorkspace) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-10 pt-7">
        <div className="rounded-[2rem] border border-line bg-white p-6 shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand">
            CarryMate
          </p>
          <h1 className="mt-3 text-[24px] font-semibold tracking-[-0.02em] text-ink">
            마지막 팀을 확인하는 중입니다
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted sm:text-base break-keep">
            로그인 계정과 저장된 팀 정보를 대조한 뒤 워크스페이스를 복원합니다.
          </p>
        </div>
      </main>
    );
  }

  if (viewMode === "onboarding") {
    return (
      <>
        <OnboardingScreen
          authLoading={authLoading}
          isAuthenticated={isAuthenticated}
          userLabel={userNickname || authenticatedUser?.email || ""}
          onCreateTeam={() => {
            setTeamSaveMessage("");
            setOnboardingSheetMode("createTeam");
          }}
          onJoinCode={() => {
            setInviteError("");
            setOnboardingSheetMode("joinTeam");
          }}
          onJoinLink={() => setOnboardingSheetMode("joinLink")}
          onJoinQr={() => setOnboardingSheetMode("joinQr")}
          onOpenAuthSignIn={() => openAuthSheet("signIn")}
          onOpenAuthSignUp={() => openAuthSheet("signUp")}
          onSignOut={handleSignOut}
          onTryDemo={loadDemoWorkspace}
        />
        <MyTeamsSection
          isAuthenticated={isAuthenticated}
          isLoading={myTeamsLoading || isWorkspaceLoading}
          message={workspaceLoadMessage || myTeamsMessage}
          teams={myTeams}
          isEnteringTeam={isWorkspaceLoading}
          onEnterTeam={(summary) => {
            void loadWorkspaceFromTeamId({
              source: "card",
              teamId: summary.team.id,
              memberRow: summary.member,
            });
          }}
          onLeaveTeam={handleLeaveTeam}
          onDeleteTeam={handleDeleteTeam}
        />
        {renderOnboardingSheet()}
        {renderAuthSheet()}
      </>
    );
  }

  return (
    <>
      <main className="carrymate-workspace mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-4 sm:px-6 lg:px-8">
        <header className="carrymate-header mb-6 rounded-[28px] p-5 sm:p-6">
          <div className="relative grid min-h-[92px] grid-cols-[56px,minmax(0,1fr),56px] items-start gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="메뉴 열기"
              aria-expanded={isMenuOpen}
              onClick={() => setIsMenuOpen((current) => !current)}
              className="neu-icon-button flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-semibold text-ink"
            >
              ☰
            </button>

            <div className="min-w-0 justify-self-center text-center md:min-w-[420px] lg:min-w-[560px]">
              <button
                type="button"
                aria-label="CarryMate 홈으로 이동"
                onClick={() => setActiveTab("home")}
                className="mx-auto inline-flex items-center justify-center"
              >
                <CarryMateLogo variant="symbol" size="sm" className="md:hidden" priority />
                <CarryMateLogo variant="full" size="lg" className="hidden md:inline-flex" priority />
              </button>
              <h1 className="mt-1 truncate text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[27px] lg:text-[32px]">
                {project.name}
              </h1>
              <p className="mt-1 truncate text-[12px] text-muted sm:text-[13px] lg:text-sm">
                {project.courseName} · {project.deadlineLabel}
              </p>
            </div>

            <div className="flex min-w-0 flex-col items-end gap-2">
              {isAuthenticated ? (
                activeTab === "home" ? null : activeTab === "tasks" ? (
                  <button
                    type="button"
                    onClick={() => openSheet("task")}
                    className="neu-primary rounded-2xl px-4 py-2.5 text-[12px] font-bold text-white"
                    aria-label="업무 추가"
                  >
                    + 업무 추가
                  </button>
                ) : activeTab === "schedule" ? (
                  <button
                    type="button"
                    onClick={() => openSheet("meeting")}
                    className="neu-primary rounded-2xl px-4 py-2.5 text-[12px] font-bold text-white"
                    aria-label="회의 만들기"
                  >
                    + 회의 만들기
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={openFileCreateDialog}
                    className="neu-primary rounded-2xl px-4 py-2.5 text-[12px] font-bold text-white"
                    aria-label="자료 추가"
                  >
                    + 자료 추가
                  </button>
                )
              ) : null}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {authLoading ? (
              <span className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-muted sm:text-xs">
                계정 확인 중
              </span>
            ) : isAuthenticated ? (
              <>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-brand">
                  {userNickname || authenticatedUser?.email}
                </span>
                <span className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-muted sm:text-xs">
                  {isTeamLeader
                    ? "팀장 연결됨"
                    : isTeamMember
                      ? "팀원 연결됨"
                      : "팀원 연결 대기"}
                </span>
                {!isTeamMember && hasPersistentProjectId ? (
                  <button
                    type="button"
                    onClick={() => {
                      void openMemberLinkSheet();
                    }}
                    className="rounded-full border border-line bg-white px-3 py-1 text-[11px] font-semibold text-ink"
                  >
                    내 팀원 정보 연결
                    </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setIsMyPageOpen(true)}
                  className="whitespace-nowrap rounded-full border border-line bg-white px-3 py-1 text-[11px] font-semibold text-ink sm:text-xs"
                >
                  마이페이지
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => openAuthSheet("signIn")}
                className="rounded-full border border-line bg-white px-3 py-1 text-[11px] font-semibold text-ink"
              >
                로그인
              </button>
            )}
          </div>
          <nav className="mt-4 grid grid-cols-4 gap-2 lg:gap-3">
            {[
              { id: "home", label: "홈" },
              { id: "tasks", label: "업무" },
              { id: "schedule", label: "일정" },
              { id: "files", label: "파일" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TabId)}
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={`inline-flex min-h-[46px] min-w-0 items-center justify-center whitespace-nowrap rounded-2xl border px-2 py-2.5 text-[12px] font-semibold tracking-[-0.01em] transition duration-200 sm:text-sm lg:min-h-[56px] lg:px-7 lg:py-3.5 lg:text-lg ${
                  activeTab === tab.id
                    ? "border-[#d8d2fb] bg-white text-brand shadow-soft"
                    : "border-transparent bg-[#fbfbfe] text-[#717588] hover:border-line hover:bg-white hover:text-ink"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          {authMessage ? (
            <p className="mt-3 rounded-2xl bg-canvas px-4 py-3 text-[12px] font-medium text-muted">
              {authMessage}
            </p>
          ) : null}
          {taskSyncMessage ? (
            <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[12px] font-medium text-warning">
              {taskSyncMessage}
            </p>
          ) : null}
          {memberSyncMessage ? (
            <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[12px] font-medium text-warning">
              {memberSyncMessage}
            </p>
          ) : null}
          {meetingSyncMessage ? (
            <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-[12px] font-medium text-warning">
              {meetingSyncMessage}
            </p>
          ) : null}
          {memberLinkMessage && !isMemberLinkSheetOpen ? (
            <p className="mt-3 rounded-2xl bg-canvas px-4 py-3 text-[12px] font-medium text-muted">
              {memberLinkMessage}
            </p>
          ) : null}
        </header>

        <section className="min-w-0 flex-1 space-y-6">
          {activeTab === "home" && (
            <HomeTab
              summary={summary}
              tasks={tasks}
              todayMeetings={todayMeetings}
              upcomingMeetings={upcomingMeetings}
              onJumpToTasks={() => setActiveTab("tasks")}
              onJumpToSchedule={() => setActiveTab("schedule")}
            />
          )}
          {activeTab === "tasks" && (
            <TaskTab
              members={members}
              tasks={tasks}
              hasUnassignedTasks={hasUnassignedTasks}
              onAddTask={() => openSheet("task")}
              onAdvanceTask={handleAdvanceTask}
              onRequestMemberExit={setPendingMemberExitId}
              onAutoRedistribute={handleAutoRedistribute}
            />
          )}
          {activeTab === "schedule" && (
            <ScheduleTab
              members={scheduleMembers}
              slots={scheduleSlots}
              meetings={confirmedMeetings}
              onAddSchedule={() => openSheet("schedule")}
              onCreateMeeting={(preset) =>
                openSheet("meeting", {
                  meetingPreset: preset
                    ? {
                        ...preset,
                        agenda: "",
                      }
                    : null,
                })
              }
              onConfirmSlot={handleConfirmSlot}
              onOpenMeeting={setActiveMeetingId}
              editableMember={editableAvailabilityMember}
              selectedAvailabilityKeys={selectedAvailabilityKeys}
              teamAvailability={teamAvailability}
              availabilityLoading={availabilityLoading}
              availabilitySaving={availabilitySaving}
              availabilityMessage={availabilityMessage}
              hasAvailabilityChanges={hasAvailabilityChanges}
              onToggleAvailability={handleToggleAvailability}
              onSaveAvailability={handleSaveAvailability}
            />
          )}
          {activeTab === "files" && (
            <FileTab
              files={files}
              canUpload={hasPersistentProjectId && Boolean(currentMember)}
              createDialogRequestId={fileCreateDialogRequestId}
              syncMessage={fileSyncMessage}
              onUploadFile={handleUploadTeamFile}
              onCreateLink={handleCreateLinkResource}
              onUpdateResource={handleUpdateResource}
              onDeleteResource={handleDeleteResource}
              onDownloadFile={handleDownloadTeamFile}
              onOpenLink={handleOpenTeamLink}
            />
          )}
        </section>

      </main>

      {typeof document !== "undefined" && viewMode === "workspace" && !isAssistantOpen
        ? createPortal(
            <button
              type="button"
              aria-label="CarryMate AI 열기"
              onClick={() => setIsAssistantOpen(true)}
              className="neu-ai-button fixed right-5 bottom-5 z-[80] flex h-14 w-14 items-center justify-center rounded-full text-white transition hover:scale-[1.04] active:scale-[0.97] sm:right-8 sm:bottom-8"
            >
              <CarryMateLogo variant="symbol" size="sm" decorative />
            </button>,
            document.body,
          )
        : null}

      <WorkspaceDrawer
        isOpen={isMenuOpen && viewMode === "workspace"}
        currentTeam={currentTeamSummary}
        isLeader={isTeamLeader}
        firstItemRef={firstMenuItemRef}
        onClose={closeWorkspaceMenu}
        onOpenInvite={() => {
          closeWorkspaceMenu();
          openInviteModal();
        }}
        onOpenProjectSettings={() => {
          closeWorkspaceMenu();
          setActiveTab("schedule");
        }}
        onOpenTeamList={() => {
          closeWorkspaceMenu();
          setViewMode("onboarding");
        }}
        onLogout={() => {
          closeWorkspaceMenu();
          void handleSignOut();
        }}
        onRequestLeave={() => requestTeamAction("leave", currentTeamSummary)}
        onRequestDelete={() => requestTeamAction("delete", currentTeamSummary)}
      />

      {pendingTeamAction ? (
        <WorkspaceTeamActionModal
          action={pendingTeamAction.kind}
          onClose={() => setPendingTeamAction(null)}
          onConfirm={async () =>
            pendingTeamAction.kind === "leave"
              ? await handleLeaveTeam(pendingTeamAction.summary)
              : await handleDeleteTeam(pendingTeamAction.summary)
          }
        />
      ) : null}

      {renderWorkspaceSheet()}
      {renderMyPageModal()}
      {isAssistantOpen ? (
        <TeamAssistantPanel
          open={isAssistantOpen}
          teamId={hasPersistentProjectId ? project.id : null}
          teamName={project.name}
          accessToken={session?.access_token ?? null}
          isDemo={!hasPersistentProjectId}
          context={assistantContext}
          onClose={() => setIsAssistantOpen(false)}
          onNavigate={(tab) => setActiveTab(tab)}
          onOpenMeeting={(meetingId) => {
            const targetMeeting =
              meetingId && confirmedMeetings.some((meeting) => meeting.id === meetingId)
                ? meetingId
                : null;
            setActiveMeetingId(targetMeeting);
            if (targetMeeting) {
              setActiveTab("schedule");
            }
          }}
        />
      ) : null}
      {isInviteModalOpen ? (
        <ShareInviteModal
          copyFeedback={copyFeedback}
          inviteCode={inviteCode || DEMO_INVITE_CODE}
          inviteLink={inviteLink || buildInviteLink(DEMO_INVITE_CODE)}
          noticeMessage=""
          onClose={closeInviteModal}
          onCopy={() => {
            void handleCopyInviteInfo();
          }}
        />
      ) : null}
      {activeMeeting ? (
        <MeetingRoomSheet
          currentMember={currentMember}
          isDemo={!hasPersistentProjectId}
          meeting={activeMeeting}
          members={members}
          tasks={tasks}
          meetings={confirmedMeetings}
          onClose={() => setActiveMeetingId(null)}
          onImportActionItems={handleImportMeetingActionItems}
          onMeetingUpdated={handleMeetingUpdated}
          projectEndDate={project.endDate}
          projectId={project.id}
        />
      ) : null}
      {renderMemberLinkSheet()}
      {renderAuthSheet()}
      {pendingExitMember ? (
        <ConfirmModal
          memberName={pendingExitMember.name}
          onCancel={() => setPendingMemberExitId(null)}
          onConfirm={handleConfirmMemberExit}
        />
      ) : null}
    </>
  );
}

function OnboardingScreen({
  authLoading,
  isAuthenticated,
  userLabel,
  onCreateTeam,
  onJoinCode,
  onJoinLink,
  onJoinQr,
  onOpenAuthSignIn,
  onOpenAuthSignUp,
  onSignOut,
  onTryDemo,
}: {
  authLoading: boolean;
  isAuthenticated: boolean;
  userLabel: string;
  onCreateTeam: () => void;
  onJoinCode: () => void;
  onJoinLink: () => void;
  onJoinQr: () => void;
  onOpenAuthSignIn: () => void;
  onOpenAuthSignUp: () => void;
  onSignOut: () => void;
  onTryDemo: () => void;
}) {
  return (
    <main className="onboarding-neu mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8">
      <section className="rounded-[2rem] border border-line bg-white/92 p-6 shadow-soft">
        <div className="rounded-[1.75rem] border border-line bg-white p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted">
            CarryMate
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em] text-ink">캐리메이트</h1>
          <p className="mt-3 text-[15px] leading-7 text-muted">
            신입생 팀플을 더 쉽게 정리하는 AI 협업 도우미
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-line bg-canvas px-4 py-3">
          {authLoading ? (
            <p className="text-[13px] font-medium text-muted">계정 상태를 확인하고 있어요.</p>
          ) : isAuthenticated ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-brand">로그인됨</p>
                <p className="mt-1 text-[13px] text-ink">{userLabel}</p>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="rounded-full border border-line bg-white px-3 py-2 text-[12px] font-semibold text-muted"
              >
                로그아웃
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-brand">선택 로그인</p>
                <p className="mt-1 text-[13px] leading-6 text-muted sm:text-sm break-keep">
                  로그인 없이 데모와 팀 참여는 그대로 사용할 수 있어요.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onOpenAuthSignIn}
                  className="rounded-full border border-line bg-white px-3 py-2 text-[12px] font-semibold text-ink"
                >
                  로그인
                </button>
                <button
                  type="button"
                  onClick={onOpenAuthSignUp}
                  className="rounded-full bg-brand px-3 py-2 text-[12px] font-semibold text-white shadow-brand"
                >
                  회원가입
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-7 space-y-3">
          <PrimaryButton label="새 팀 만들기" onClick={onCreateTeam} />
          <button
            type="button"
            onClick={onJoinCode}
            className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-4 text-left shadow-soft"
          >
            <span className="text-sm font-semibold text-ink">초대 코드로 참여하기</span>
            <span className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-muted sm:text-xs">
              CODE
            </span>
          </button>
          <button
            type="button"
            onClick={onJoinLink}
            className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-4 text-left shadow-soft"
          >
            <span className="text-sm font-semibold text-ink">초대 링크로 참여하기</span>
            <span className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-muted sm:text-xs">
              LINK
            </span>
          </button>
          <button
            type="button"
            onClick={onJoinQr}
            className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-4 text-left shadow-soft"
          >
            <span className="text-sm font-semibold text-ink">QR 스캔으로 팀 참여하기</span>
            <span className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-muted sm:text-xs">
              QR
            </span>
          </button>
          <button
            type="button"
            onClick={onTryDemo}
            className="w-full rounded-2xl border border-line bg-white px-4 py-4 text-sm font-semibold text-ink shadow-soft"
          >
            데모 팀으로 바로 체험하기
          </button>
        </div>
      </section>
    </main>
  );
}

function MyTeamsSection({
  isAuthenticated,
  isLoading,
  isEnteringTeam,
  message,
  onEnterTeam,
  onLeaveTeam,
  onDeleteTeam,
  teams,
}: {
  isAuthenticated: boolean;
  isLoading: boolean;
  isEnteringTeam: boolean;
  message: string;
  onEnterTeam: (summary: ProfileTeamSummary) => void;
  onLeaveTeam: (summary: ProfileTeamSummary) => Promise<{ ok: boolean; message: string }>;
  onDeleteTeam: (summary: ProfileTeamSummary) => Promise<{ ok: boolean; message: string }>;
  teams: ProfileTeamSummary[];
}) {
  const [menuTeamId, setMenuTeamId] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<
    | { kind: "none" }
    | { kind: "leave"; summary: ProfileTeamSummary }
    | { kind: "delete"; summary: ProfileTeamSummary }
  >({ kind: "none" });
  const [dialogMessage, setDialogMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isAuthenticated) {
    return null;
  }

  const closeDialog = () => {
    setDialogState({ kind: "none" });
    setDialogMessage("");
    setIsSubmitting(false);
  };

  const handleEnterTeam = (summary: ProfileTeamSummary) => {
    if (isLoading || isEnteringTeam) {
      return;
    }

    onEnterTeam(summary);
  };

  return (
    <section className="mx-auto mt-4 w-full max-w-md px-4 pb-6">
      <div className="rounded-[2rem] border border-line bg-white p-5 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand sm:text-xs">
              My Teams
            </p>
            <h2 className="mt-1 text-lg font-semibold text-ink">내 팀</h2>
          </div>
          <span className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-muted sm:text-xs">
            {teams.length}개 팀
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {isLoading ? (
            <div className="rounded-2xl border border-line bg-canvas px-4 py-4 text-sm text-muted">
              {message || "내 팀 조회 중"}
            </div>
          ) : teams.length > 0 ? (
            teams.map((summary) => (
              <div
                key={summary.member.id}
                role="button"
                tabIndex={isLoading || isEnteringTeam ? -1 : 0}
                aria-disabled={isLoading || isEnteringTeam}
                onClick={() => handleEnterTeam(summary)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleEnterTeam(summary);
                  }
                }}
                className={`rounded-2xl border border-line bg-white px-4 py-4 shadow-soft transition ${
                  isLoading || isEnteringTeam
                    ? "cursor-not-allowed opacity-70"
                    : "cursor-pointer hover:-translate-y-0.5 hover:shadow-md"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{summary.team.team_name}</p>
                    <p className="mt-1 text-[12px] text-muted">
                      {summary.team.course_name} · {summary.team.deadline_label}
                    </p>
                    <p className="mt-2 text-[12px] text-muted">
                      내 역할: {summary.member.role}
                      {summary.member.is_leader ? " · 팀장" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleEnterTeam(summary);
                      }}
                      className="rounded-xl bg-brand px-3 py-2 text-[12px] font-semibold text-white shadow-brand"
                      disabled={isLoading || isEnteringTeam}
                    >
                      들어가기
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isLoading || isEnteringTeam) {
                          return;
                        }
                        setMenuTeamId((current) =>
                          current === summary.team.id ? null : summary.team.id,
                        );
                      }}
                      className="rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-semibold text-muted"
                      disabled={isLoading || isEnteringTeam}
                    >
                      더보기
                    </button>
                    {menuTeamId === summary.team.id ? (
                      <div className="w-36 rounded-2xl border border-line bg-white p-2 shadow-soft">
                        {summary.member.is_leader ? null : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setMenuTeamId(null);
                              setDialogState({ kind: "leave", summary });
                            }}
                            className="w-full rounded-xl px-3 py-2 text-left text-[12px] font-semibold text-ink hover:bg-canvas"
                          >
                            팀 나가기
                          </button>
                        )}
                        {summary.member.is_leader ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setMenuTeamId(null);
                              setDialogState({ kind: "delete", summary });
                            }}
                            className="w-full rounded-xl px-3 py-2 text-left text-[12px] font-semibold text-danger hover:bg-canvas"
                          >
                            팀 삭제
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-white px-4 py-4 text-sm text-muted">
              {message || "아직 소속된 실제 팀이 없습니다."}
            </div>
          )}
        </div>

        {dialogState.kind !== "none" ? (
          <TeamActionModal
            action={dialogState.kind}
            message={dialogMessage}
            isSubmitting={isSubmitting}
            onClose={closeDialog}
            onAction={async () => {
              if (isSubmitting) {
                return;
              }

              setIsSubmitting(true);
              const result =
                dialogState.kind === "leave"
                  ? await onLeaveTeam(dialogState.summary)
                  : await onDeleteTeam(dialogState.summary);

              setDialogMessage(result.message);
              if (result.ok) {
                closeDialog();
              }
              setIsSubmitting(false);
            }}
          />
        ) : null}
      </div>
    </section>
  );
}

function TeamActionModal({
  action,
  isSubmitting,
  message,
  onAction,
  onClose,
}: {
  action: "leave" | "delete";
  isSubmitting: boolean;
  message: string;
  onAction: () => void;
  onClose: () => void;
}) {
  const isDelete = action === "delete";
  const body = isDelete
    ? "팀을 삭제하시겠습니까?\n\n현재 팀의 업무, 회의, 채팅, 회의록, 공강 정보,\n파일과 링크가 함께 삭제될 수 있습니다.\n\n이 작업은 되돌릴 수 없습니다."
    : "팀에서 나가시겠습니까?\n\n다시 참여하려면 초대 코드가 필요합니다.";

  return (
    <ModalShell
      title={isDelete ? "팀을 삭제하시겠습니까?" : "팀에서 나가시겠습니까?"}
      onClose={onClose}
      tone="confirm"
    >
      <p className="whitespace-pre-line text-[13px] leading-7 text-muted">{body}</p>
      {message ? (
        <p className="mt-4 rounded-2xl bg-[#f7f9fd] px-4 py-3 text-[12px] leading-6 text-[#445066]">
          {message}
        </p>
      ) : null}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-2xl border border-line bg-white px-4 py-3 font-semibold text-muted"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onAction}
          disabled={isSubmitting}
          className={`rounded-2xl px-4 py-3 font-semibold text-white shadow-brand disabled:opacity-60 ${
            isDelete ? "bg-danger" : "bg-brand"
          }`}
        >
          {isSubmitting ? "삭제 중..." : isDelete ? "삭제" : "나가기"}
        </button>
      </div>
    </ModalShell>
  );
}

function SplashScreen() {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-6 py-10"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex w-full max-w-sm flex-col items-center rounded-[32px] border border-line bg-white px-8 py-10 text-center shadow-soft sm:px-10 sm:py-12">
        <CarryMateLogo variant="full" size="xl" priority className="justify-center" />
        <p className="mt-5 text-sm leading-6 text-muted sm:text-base">
          AI와 함께하는 대학생 팀 프로젝트 플랫폼
        </p>
        <div className="mt-6 flex items-center gap-2 text-brand motion-reduce:animate-none">
          <span className="h-2.5 w-2.5 rounded-full bg-brand animate-pulse motion-reduce:animate-none" />
          <span className="h-2.5 w-2.5 rounded-full bg-brand/70 animate-pulse motion-reduce:animate-none [animation-delay:120ms]" />
          <span className="h-2.5 w-2.5 rounded-full bg-brand/40 animate-pulse motion-reduce:animate-none [animation-delay:240ms]" />
        </div>
      </div>
    </div>
  );
}

function WorkspaceDrawer({
  isOpen,
  currentTeam,
  isLeader,
  firstItemRef,
  onClose,
  onOpenInvite,
  onOpenProjectSettings,
  onOpenTeamList,
  onRequestDelete,
  onRequestLeave,
  onLogout,
}: {
  isOpen: boolean;
  currentTeam: ProfileTeamSummary | null;
  isLeader: boolean;
  firstItemRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpenInvite: () => void;
  onOpenProjectSettings: () => void;
  onOpenTeamList: () => void;
  onRequestDelete: () => void;
  onRequestLeave: () => void;
  onLogout: () => void;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="메뉴 닫기"
        className="absolute inset-0 bg-slate-950/35"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-drawer-title"
        className="absolute left-0 top-0 flex h-full w-[min(88vw,20rem)] max-w-[20rem] flex-col border-r border-line bg-white p-4 shadow-[20px_0_50px_rgba(15,23,42,0.15)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand sm:text-xs">
              Menu
            </p>
            <h2 id="workspace-drawer-title" className="mt-1 text-lg font-semibold text-ink">
              메뉴
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-canvas px-3 py-2 text-sm font-semibold text-muted"
          >
            닫기
          </button>
        </div>

        <div className="mt-4 space-y-2 overflow-y-auto pr-1">
          <DrawerCard
            title="현재 팀 정보"
            description={
              currentTeam
                ? `${currentTeam.team.team_name}\n${currentTeam.team.course_name}\n현재 역할: ${currentTeam.member.role}${currentTeam.member.is_leader ? " · 팀장" : ""}`
                : "현재 팀 정보를 불러올 수 없습니다."
            }
          />
          <DrawerButton buttonRef={firstItemRef} onClick={onOpenTeamList}>
            내 팀
          </DrawerButton>
          <DrawerButton onClick={onOpenInvite}>팀원 초대</DrawerButton>
          <DrawerButton onClick={onOpenProjectSettings}>프로젝트 설정</DrawerButton>
          <div className="mt-2 border-t border-line pt-2">
          {isLeader ? (
            <>
              <DrawerButton tone="danger" onClick={onRequestDelete}>
                팀 삭제
              </DrawerButton>
            </>
          ) : (
            <DrawerButton tone="danger" onClick={onRequestLeave}>
              팀 나가기
            </DrawerButton>
          )}
          </div>
          <DrawerButton tone="muted" onClick={onLogout}>
            로그아웃
          </DrawerButton>
        </div>
      </aside>
    </div>
  );
}

function DrawerCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-canvas px-4 py-4">
      <p className="text-[12px] font-semibold text-brand">{title}</p>
      <p className="mt-2 whitespace-pre-line text-[13px] leading-6 text-muted sm:text-sm break-keep">{description}</p>
    </div>
  );
}

function DrawerButton({
  children,
  onClick,
  tone = "default",
  buttonRef,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "default" | "danger" | "muted";
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const toneClass =
    tone === "danger"
      ? "text-[#b54d4d]"
      : tone === "muted"
        ? "text-muted"
        : "text-ink";

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-4 text-left text-[13px] font-semibold shadow-soft ${toneClass}`}
    >
      {children}
      <span className="text-[11px] text-muted">›</span>
    </button>
  );
}

function WorkspaceTeamActionModal({
  action,
  onClose,
  onConfirm,
}: {
  action: "leave" | "delete";
  onClose: () => void;
  onConfirm: () => Promise<{ ok: boolean; message: string }>;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const isDelete = action === "delete";
  const body = isDelete
    ? "팀을 삭제하시겠습니까?\n\n현재 팀의 업무, 회의, 채팅, 회의록, 공강 정보,\n파일과 링크가 함께 삭제될 수 있습니다.\n\n이 작업은 되돌릴 수 없습니다."
    : "팀에서 나가시겠습니까?\n\n다시 참여하려면 초대 코드가 필요합니다.";

  return (
    <ModalShell
      title={isDelete ? "팀을 삭제하시겠습니까?" : "팀에서 나가시겠습니까?"}
      onClose={onClose}
      tone="confirm"
    >
      <p className="whitespace-pre-line text-[13px] leading-7 text-muted">{body}</p>
      {message ? (
        <p className="mt-4 rounded-2xl bg-[#f7f9fd] px-4 py-3 text-[12px] leading-6 text-[#445066]">
          {message}
        </p>
      ) : null}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-2xl border border-line bg-white px-4 py-3 font-semibold text-muted"
        >
          취소
        </button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={async () => {
            if (isSubmitting) {
              return;
            }

            setIsSubmitting(true);
            const result = await onConfirm();
            setMessage(result.message);
            if (result.ok) {
              onClose();
            }
            setIsSubmitting(false);
          }}
          className={`rounded-2xl px-4 py-3 font-semibold text-white shadow-brand disabled:opacity-60 ${
            isDelete ? "bg-danger" : "bg-brand"
          }`}
        >
          {isSubmitting ? "삭제 중..." : isDelete ? "삭제" : "나가기"}
        </button>
      </div>
    </ModalShell>
  );
}

function AuthSheet({
  mode,
  message,
  isSubmitting,
  onClose,
  onChangeMode,
  onSignIn,
  onSignUp,
}: {
  mode: AuthMode;
  message: string;
  isSubmitting: boolean;
  onClose: () => void;
  onChangeMode: (mode: AuthMode) => void;
  onSignIn: (input: { email: string; password: string }) => Promise<boolean>;
  onSignUp: (input: {
    email: string;
    password: string;
    nickname: string;
  }) => Promise<boolean>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [localMessage, setLocalMessage] = useState("");

  return (
    <SheetShell title={mode === "signIn" ? "로그인" : "회원가입"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-canvas p-1">
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

      <div className="space-y-3">
        <SheetInput
          label="이메일"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="예: carrymate@example.com"
        />
        <SheetInput
          label="비밀번호"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="6자 이상 입력해 주세요"
        />
        {mode === "signUp" ? (
          <SheetInput
            label="닉네임 (선택)"
            value={nickname}
            onChange={setNickname}
            placeholder="예: 민지"
          />
        ) : null}
      </div>

      {localMessage || message ? (
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-muted sm:text-base break-keep">
          {localMessage || message}
        </p>
      ) : null}

      <PrimaryButton
        label={
          isSubmitting
            ? mode === "signIn"
              ? "로그인 중..."
              : "가입 중..."
            : mode === "signIn"
              ? "로그인"
              : "회원가입"
        }
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
            await onSignIn({
              email,
              password,
            });
            return;
          }

          await onSignUp({
            email,
            password,
            nickname,
          });
        }}
      />
    </SheetShell>
  );
}

function InviteLinkModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <SheetShell title="초대 링크로 참여하기" onClose={onClose}>
      <div className="rounded-2xl border border-line bg-canvas p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted sm:text-xs">
          초대 링크 확인
        </p>
        <p className="mt-3 break-all text-[13px] font-semibold text-ink">
          carrymate.app/join/CARRY2026
        </p>
        <p className="mt-3 text-[13px] leading-6 text-muted sm:text-sm break-keep">
          초대 링크가 확인되었습니다. 확인 버튼을 누르면 데모 팀으로 바로 입장합니다.
        </p>
      </div>
      <PrimaryButton label="확인" onClick={onConfirm} />
    </SheetShell>
  );
}

function QrScannerModal({
  onClose,
  onScanSuccess,
}: {
  onClose: () => void;
  onScanSuccess: () => void;
}) {
  return (
    <ModalShell title="QR 스캔으로 팀 참여하기" onClose={onClose} tone="dark">
      <p className="mt-1 text-sm leading-6 text-slate-300">
        아래 스캔 프레임을 눌러 데모 QR을 스캔하세요.
      </p>
      <button
        type="button"
        onClick={onScanSuccess}
        className="relative mt-5 flex aspect-square w-full items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/15 bg-[linear-gradient(180deg,#0f172a,#111c31)]"
      >
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:24px_24px]" />
        <div className="absolute inset-x-8 top-1/2 h-px -translate-y-1/2 bg-brand/70 shadow-[0_0_12px_rgba(0,113,227,0.18)]" />
        <div className="relative h-56 w-56 rounded-[1.5rem] border border-white/25 bg-white/5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <Corner className="left-0 top-0 border-l-4 border-t-4" />
          <Corner className="right-0 top-0 border-r-4 border-t-4" />
          <Corner className="bottom-0 left-0 border-b-4 border-l-4" />
          <Corner className="bottom-0 right-0 border-b-4 border-r-4" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white">
              탭해서 CARRY2026 스캔
            </span>
          </div>
        </div>
      </button>
    </ModalShell>
  );
}

function ShareInviteModal({
  copyFeedback,
  inviteCode,
  inviteLink,
  noticeMessage,
  onCopy,
  onClose,
}: {
  copyFeedback: string;
  inviteCode: string;
  inviteLink: string;
  noticeMessage: string;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <ModalShell title="팀원 초대 공유" onClose={onClose}>
      <div className="rounded-[1.75rem] border border-line bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted sm:text-xs">
          팀 생성 완료
        </p>
        <p className="mt-2 text-[13px] leading-6 text-muted sm:text-sm break-keep">
          발표 전에 코드, 링크, QR 중 편한 방식으로 바로 공유할 수 있어요.
        </p>
        {noticeMessage ? (
          <p className="mt-3 rounded-2xl bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-success">
            {noticeMessage}
          </p>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        <InviteInfoCard label="초대 코드" value={inviteCode} />
        <InviteInfoCard label="초대 링크" value={inviteLink} />
        <div className="rounded-2xl border border-line bg-canvas p-4">
          <p className="text-[13px] font-semibold text-ink">초대 QR</p>
          <FakeQrCode value={inviteLink} />
        </div>
      </div>

      {copyFeedback ? (
        <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-success">
          {copyFeedback}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onCopy}
          className="rounded-2xl border border-line bg-white px-4 py-3 font-semibold text-ink"
        >
          복사하기
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-2xl bg-brand px-4 py-3 font-semibold text-white shadow-brand"
        >
          닫고 입장하기
        </button>
      </div>
    </ModalShell>
  );
}

function MemberLinkSheet({
  creatorName,
  isLoading,
  members,
  message,
  onClose,
  onClaim,
  onCreateNew,
}: {
  creatorName: string;
  isLoading: boolean;
  members: TeamMemberRow[];
  message: string;
  onClose: () => void;
  onClaim: (memberId: string) => void;
  onCreateNew: () => void;
}) {
  return (
    <SheetShell title="내 팀원 정보 연결" onClose={onClose}>
      <p className="text-sm leading-6 text-muted sm:text-base break-keep">
        이름이 같다는 이유만으로 자동 연결하지 않습니다. 아래 미연결 팀원 중 내 항목을 선택하거나, 없으면 새 팀원으로 참여해 주세요.
      </p>
      <div className="space-y-3">
        {members.length > 0 ? (
          members.map((member) => (
            <button
              key={member.id}
              type="button"
              disabled={isLoading}
              onClick={() => onClaim(member.id)}
              className="flex w-full items-center justify-between rounded-2xl border border-line bg-white px-4 py-4 text-left shadow-soft disabled:opacity-60"
            >
              <div>
                <p className="text-sm font-semibold text-ink">{member.name}</p>
                <p className="mt-1 text-[12px] text-muted">
                  {member.role} · {member.skill_tag}
                </p>
              </div>
              <span className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-muted sm:text-xs">
                선택
              </span>
            </button>
          ))
        ) : (
          <div className="rounded-2xl border border-line bg-canvas px-4 py-4 text-sm leading-6 text-muted sm:text-base break-keep">
            아직 연결 가능한 초대 대상 팀원이 없습니다. 내 이름으로 새 팀원 참여를 만들 수 있어요.
          </div>
        )}
      </div>
      {message ? (
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-muted sm:text-base break-keep">
          {message}
        </p>
      ) : null}
      <button
        type="button"
        disabled={isLoading}
        onClick={onCreateNew}
        className="w-full rounded-2xl border border-line bg-white px-4 py-4 text-sm font-semibold text-ink shadow-soft disabled:opacity-60"
      >
        {isLoading ? "연결 중..." : `${creatorName} 이름으로 새 팀원 참여`}
      </button>
    </SheetShell>
  );
}

function CreateTeamSheet({
  creatorName,
  onClose,
  onSubmit,
  submitMessage,
}: {
  creatorName: string;
  onClose: () => void;
  onSubmit: (input: {
    teamName: string;
    courseName: string;
    memberNames: string;
    description: string;
    startDate: string;
    endDate: string;
  }) => Promise<boolean>;
  submitMessage: string;
}) {
  // TODO: Supabase 연동 시 이 폼 상태는 react-hook-form + 서버 submit 로직으로 대체 가능
  const [teamName, setTeamName] = useState("");
  const [courseName, setCourseName] = useState("");
  const [memberNames, setMemberNames] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localMessage, setLocalMessage] = useState("");

  return (
    <SheetShell title="새 팀 만들기" onClose={onClose}>
      {creatorName ? (
        <div className="rounded-2xl border border-line bg-canvas px-4 py-3">
          <p className="text-[12px] font-semibold text-brand">로그인 팀장 자동 추가</p>
          <p className="mt-1 text-[13px] leading-6 text-muted sm:text-sm break-keep">
            {creatorName}님은 자동으로 팀장으로 추가됩니다. 아래에는 초대할 팀원 이름만 입력해 주세요.
          </p>
        </div>
      ) : null}
      <div className="space-y-3">
        <SheetInput
          label="팀명"
          value={teamName}
          onChange={setTeamName}
          placeholder="예: HCI 발표 3팀"
        />
        <SheetInput
          label="과목명"
          value={courseName}
          onChange={setCourseName}
          placeholder="예: 인간컴퓨터상호작용"
        />
        <SheetInput
          label="프로젝트 설명 (선택)"
          value={description}
          onChange={setDescription}
          placeholder="예: 발표 준비 목표를 간단히 적어주세요"
        />
        <SheetInput
          label="프로젝트 시작일 (선택)"
          type="date"
          value={startDate}
          onChange={setStartDate}
          placeholder=""
        />
        <SheetInput
          label="프로젝트 마감일"
          type="date"
          value={endDate}
          onChange={setEndDate}
          placeholder=""
        />
        <SheetInput
          label={creatorName ? "초대할 팀원 이름" : "초기 팀원 이름"}
          value={memberNames}
          onChange={setMemberNames}
          placeholder="예: 민지, 준호, 서연"
        />
      </div>
      {localMessage || submitMessage ? (
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-muted sm:text-base break-keep">
          {localMessage || submitMessage}
        </p>
      ) : null}
      <PrimaryButton
        label={isSubmitting ? "저장 중..." : "생성하기"}
        onClick={async () => {
          if (isSubmitting) {
            return;
          }
          if (!teamName.trim() || !courseName.trim() || !endDate.trim()) {
            setLocalMessage("팀명, 과목명, 프로젝트 마감일을 모두 입력해 주세요.");
            return;
          }
          if (startDate && startDate > endDate) {
            setLocalMessage("프로젝트 마감일은 시작일보다 빠를 수 없어요.");
            return;
          }
          setLocalMessage("");
          setIsSubmitting(true);
          const ok = await onSubmit({
            teamName,
            courseName,
            memberNames,
            description,
            startDate,
            endDate,
          });
          if (!ok) {
            setLocalMessage(
              "Supabase 저장에 실패했습니다. 환경변수와 teams 테이블 정책을 확인해 주세요.",
            );
          }
          setIsSubmitting(false);
        }}
      />
    </SheetShell>
  );
}

function JoinTeamSheet({
  errorMessage,
  onClose,
  onSubmit,
}: {
  errorMessage: string;
  onClose: () => void;
  onSubmit: (code: string) => boolean;
}) {
  // TODO: Supabase 연동 시 inviteCode는 서버 검증 요청 payload로 사용 가능
  const [inviteCode, setInviteCode] = useState("");

  return (
    <SheetShell title="초대 코드로 참여하기" onClose={onClose}>
      <SheetInput
        label="초대 코드"
        value={inviteCode}
        onChange={setInviteCode}
        placeholder="예: CARRY2026"
      />
      {errorMessage ? (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-danger">
          {errorMessage}
        </p>
      ) : (
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm text-muted">
          데모 코드는 CARRY2026입니다.
        </p>
      )}
      <PrimaryButton
        label="참여하기"
        onClick={() => {
          onSubmit(inviteCode);
        }}
      />
    </SheetShell>
  );
}

function ConfirmModal({
  memberName,
  onCancel,
  onConfirm,
}: {
  memberName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title={`${memberName}님 나가기`} onClose={onCancel} tone="confirm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted sm:text-xs">
        팀원 변경
      </p>
      <p className="mt-3 text-[13px] leading-7 text-muted">
        정말로 이 팀원이 나가나요? 해당 팀원의 업무가 담당자 미정 상태로 전환됩니다.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-2xl border border-line bg-white px-4 py-3 font-semibold text-muted"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-2xl bg-brand px-4 py-3 font-semibold text-white shadow-brand"
        >
          승인
        </button>
      </div>
    </ModalShell>
  );
}

function QuickActionSheet({
  title,
  description,
  actionLabel,
  placeholder,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  actionLabel: string;
  placeholder: string;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  // TODO: Supabase 연동 시 이 입력값은 생성 API mutation payload로 대체 가능
  const [value, setValue] = useState("");

  return (
    <SheetShell title={title} onClose={onClose}>
      <p className="text-sm leading-6 text-muted sm:text-base break-keep">{description}</p>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="mt-4 w-full rounded-2xl border border-line bg-white px-4 py-3 outline-none transition focus:border-brand"
      />
      <PrimaryButton
        label={actionLabel}
        onClick={() => {
          const trimmedValue = value.trim();
          if (!trimmedValue) {
            return;
          }
          onSubmit(trimmedValue);
        }}
      />
    </SheetShell>
  );
}

function MeetingCreateSheet({
  initialValues,
  onClose,
  onSubmit,
}: {
  initialValues?: {
    title: string;
    startsAt: string;
    endsAt: string;
    agenda: string;
  } | null;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    startsAt: string;
    endsAt: string;
    agenda: string;
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [agenda, setAgenda] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setTitle(initialValues?.title ?? "");
    setStartsAt(initialValues?.startsAt ?? "");
    setEndsAt(initialValues?.endsAt ?? "");
    setAgenda(initialValues?.agenda ?? "");
    setMessage("");
  }, [initialValues]);

  return (
    <SheetShell title="회의 만들기" onClose={onClose}>
      <p className="text-sm leading-6 text-muted sm:text-base break-keep">
        실제 UUID 팀에서는 회의가 DB에 저장되고, 종료 후 채팅 요약과 할 일 전송까지 연결됩니다.
      </p>
      <div className="space-y-3">
        <SheetInput
          label="회의 제목"
          value={title}
          onChange={setTitle}
          placeholder="예: 발표 리허설 회의"
        />
        <SheetInput
          label="시작 시각"
          type="datetime-local"
          value={startsAt}
          onChange={setStartsAt}
          placeholder=""
        />
        <SheetInput
          label="종료 시각 (선택)"
          type="datetime-local"
          value={endsAt}
          onChange={setEndsAt}
          placeholder=""
        />
        <SheetTextarea
          label="안건 (선택)"
          value={agenda}
          onChange={setAgenda}
          placeholder="예: 발표 순서 확정, 역할 점검, 최종 수정 사항 정리"
          rows={3}
        />
      </div>
      {message ? (
        <p className="rounded-2xl bg-canvas px-4 py-3 text-sm leading-6 text-muted sm:text-base break-keep">
          {message}
        </p>
      ) : null}
      <PrimaryButton
        label={isSubmitting ? "회의 생성 중..." : "회의 생성"}
        onClick={async () => {
          if (isSubmitting) {
            return;
          }

          if (!title.trim() || !startsAt.trim()) {
            setMessage("회의 제목과 시작 시각을 입력해 주세요.");
            return;
          }

          if (endsAt && endsAt < startsAt) {
            setMessage("종료 시각은 시작 시각보다 빠를 수 없습니다.");
            return;
          }

          setMessage("");
          setIsSubmitting(true);
          const ok = await onSubmit({ title, startsAt, endsAt, agenda });
          if (!ok) {
            setMessage("회의 생성에 실패했습니다. Supabase 정책과 환경변수를 확인해 주세요.");
          }
          setIsSubmitting(false);
        }}
      />
    </SheetShell>
  );
}

function SheetShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="space-y-4">{children}</div>
    </ModalShell>
  );
}

function SheetInput({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type?: "text" | "date" | "datetime-local" | "email" | "password";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-ink">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="neu-field w-full rounded-2xl px-4 py-3 outline-none transition"
      />
    </label>
  );
}

function SheetTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-ink">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="neu-field w-full resize-none rounded-2xl px-4 py-3 outline-none transition"
      />
    </label>
  );
}

function PrimaryButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="neu-primary-soft w-full rounded-2xl px-4 py-4 text-sm font-semibold text-white"
    >
      {label}
    </button>
  );
}

function InviteInfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-canvas p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        {label}
      </p>
      <p className="mt-2 break-all text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function FakeQrCode({ value }: { value: string }) {
  const cells = Array.from({ length: 64 }, (_, index) => {
    const sourceChar = value.charCodeAt(index % Math.max(value.length, 1)) || 0;
    return (sourceChar + index * 7) % 3 === 0 ? 1 : 0;
  });

  return (
    <div className="mt-3 flex justify-center">
      <div className="grid grid-cols-8 gap-1 rounded-2xl bg-white p-3 shadow-soft">
        {cells.map((cell, index) => (
          <span
            key={`${cell}-${index}`}
            className={`h-4 w-4 rounded-[4px] ${cell ? "bg-ink" : "bg-white"}`}
          />
        ))}
      </div>
    </div>
  );
}

function Corner({ className }: { className: string }) {
  return <span className={`absolute h-8 w-8 border-brand ${className}`} />;
}

