"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  isUuid,
  mapMeetingMessageRowsToMeetingMessages,
  mapMeetingNoteRowToMeetingNote,
} from "@/lib/mappers/carrymate";
import { serializeMeetingNoteContent } from "@/lib/carrymate/meeting-note-content";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createMeetingMessage,
  createMeetingNote,
  deleteMeetingMessage,
  endMeeting,
  getMeetingMessages,
  getMeetingNoteByMeetingId,
  updateMeetingMessage,
} from "@/lib/supabase/meetings";
import {
  ConfirmedMeeting,
  MeetingActionItem,
  MeetingMessage,
  MeetingNote,
  Task,
  TaskPriority,
  TeamMember,
} from "@/types/carrymate";

type ImportResult = {
  ok: boolean;
  message: string;
  imported: Array<{ key: string; taskId: string | null }>;
  failed: Array<{ key: string; message: string }>;
};

type AnalysisStep = 0 | 1 | 2 | 3 | 4;

type MeetingAiPayload = {
  error?: string;
  summary?: string;
  decisions?: string[];
  unresolvedItems?: string[];
  actionItems?: MeetingActionItem[];
};

type AssistantFeedback = {
  participationRate: number;
  participationStars: number;
  focusScore: number;
  decisionCount: number;
  unresolvedCount: number;
  generatedTaskCount: number;
  healthScore: number;
  risks: string[];
  nextActions: string[];
  productivityScore: number;
  productivityMessage: string;
  timeline: string[];
};

const DEMO_MESSAGES: MeetingMessage[] = [
  {
    id: "demo-message-1",
    meetingId: "demo-meeting",
    memberId: "member-1",
    senderName: "민수",
    message: "발표자는 소연으로 확정하고 자료 조사 역할은 오늘 안에 정리해요.",
    createdAt: new Date().toISOString(),
  },
  {
    id: "demo-message-2",
    meetingId: "demo-meeting",
    memberId: "member-2",
    senderName: "지은",
    message: "디자인 색상은 아직 못 정했어요. 경쟁 서비스 비교도 같이 보고 결정해요.",
    createdAt: new Date().toISOString(),
  },
  {
    id: "demo-message-3",
    meetingId: "demo-meeting",
    memberId: "member-3",
    senderName: "소연",
    message: "내일 오전까지 첫 화면 시안과 발표 흐름을 같이 공유할게요.",
    createdAt: new Date().toISOString(),
  },
];

const STATUS_META = {
  scheduled: {
    label: "예정",
    className: "bg-violet-50 text-violet-600",
  },
  inProgress: {
    label: "진행 중",
    className: "bg-blue-50 text-brand",
  },
  ended: {
    label: "종료",
    className: "bg-slate-100 text-slate-600",
  },
} as const;

const ANALYSIS_STEPS: Array<{ step: Exclude<AnalysisStep, 0>; label: string; detail: string }> = [
  { step: 1, label: "AI 분석", detail: "대화 흐름과 핵심 안건을 읽고 있습니다." },
  { step: 2, label: "회의록 생성", detail: "요약과 결정 사항을 정리하고 있습니다." },
  { step: 3, label: "Tasks 생성", detail: "Action Item 후보를 업무 초안으로 정리합니다." },
  { step: 4, label: "완료", detail: "회의록 저장과 후속 작업 준비가 끝났습니다." },
];

const PRIORITY_META: Record<TaskPriority, { label: string; className: string }> = {
  high: {
    label: "높음",
    className: "bg-rose-50 text-rose-600",
  },
  medium: {
    label: "보통",
    className: "bg-amber-50 text-amber-600",
  },
  low: {
    label: "낮음",
    className: "bg-emerald-50 text-emerald-600",
  },
};

function buildActionKey(index: number) {
  return `action-${index}`;
}

function dedupeMessages(messages: MeetingMessage[]) {
  const seen = new Set<string>();

  return messages.filter((message) => {
    if (seen.has(message.id)) {
      return false;
    }

    seen.add(message.id);
    return true;
  });
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function buildTranscript(messages: MeetingMessage[]) {
  return messages
    .map(
      (message) =>
        `[${formatMessageTime(message.createdAt)}] ${message.senderName}: ${message.message}`,
    )
    .join("\n");
}

function startOfDayIso(offsetDays: number) {
  const date = new Date();
  date.setHours(18, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString();
}

function normalizeActionItem(item: MeetingActionItem): MeetingActionItem {
  return {
    ...item,
    priority: item.priority ?? "medium",
    dueAt: item.dueAt ?? startOfDayIso(item.dueDateOffsetDays),
  };
}

function formatActionDate(value?: string | null) {
  if (!value) {
    return "마감 미정";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "마감 미정";
  }

  return date.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createDemoSummary(messages: MeetingMessage[]) {
  const senders = Array.from(new Set(messages.map((message) => message.senderName)));

  return {
    summary:
      "발표 구성과 역할 분담이 정리됐고, 디자인 방향과 비교 자료 검토가 다음 결정 포인트로 남았습니다.",
    decisions: ["발표자는 소연으로 확정", "비교 자료와 첫 화면 시안을 함께 검토"],
    unresolvedItems: ["디자인 메인 색상 결정", "최종 발표 순서 조정"],
    actionItems: [
      {
        title: "발표 흐름 초안 정리",
        assigneeName: senders[2] ?? "",
        priority: "high" as const,
        dueDateOffsetDays: 1,
        dueAt: startOfDayIso(1),
      },
      {
        title: "경쟁 서비스 비교 자료 정리",
        assigneeName: senders[1] ?? "",
        priority: "medium" as const,
        dueDateOffsetDays: 1,
        dueAt: startOfDayIso(1),
      },
      {
        title: "첫 화면 시안 공유",
        assigneeName: senders[0] ?? "",
        priority: "medium" as const,
        dueDateOffsetDays: 2,
        dueAt: startOfDayIso(2),
      },
    ],
  };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatRelativeDays(days: number) {
  if (days <= 0) {
    return "오늘";
  }

  if (days === 1) {
    return "1일";
  }

  return `${days}일`;
}

function formatTimelineTime(value?: string | null) {
  if (!value) {
    return "--:--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getDaysUntil(value?: string) {
  if (!value) {
    return null;
  }

  const target = new Date(value);
  if (Number.isNaN(target.getTime())) {
    return null;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  );

  return Math.ceil((startOfTarget.getTime() - startOfToday.getTime()) / 86400000);
}

function buildAssistantFeedback(input: {
  meeting: ConfirmedMeeting;
  members: TeamMember[];
  tasks: Task[];
  meetings: ConfirmedMeeting[];
  messages: MeetingMessage[];
  decisions: string[];
  unresolvedItems: string[];
  actionItems: MeetingActionItem[];
  projectEndDate?: string;
}) {
  const activeMembers = input.members.filter((member) => member.status === "active");
  const participantNameSet = new Set(
    input.messages.map((message) => message.senderName.trim()).filter(Boolean),
  );
  const participantCount = activeMembers.filter((member) =>
    participantNameSet.has(member.name.trim()),
  ).length;
  const participationRate =
    activeMembers.length === 0 ? 100 : Math.round((participantCount / activeMembers.length) * 100);
  const participationStars = Math.max(1, Math.min(5, Math.round(participationRate / 20)));

  const overdueTasks = input.tasks.filter((task) => {
    if (task.status === "done" || !task.dueAt) {
      return false;
    }

    return new Date(task.dueAt).getTime() < Date.now();
  });
  const unassignedTasks = input.tasks.filter((task) => task.assigneeId === null);
  const doneCount = input.tasks.filter((task) => task.status === "done").length;
  const progress =
    input.tasks.length === 0 ? 100 : Math.round((doneCount / input.tasks.length) * 100);

  const recentEndedMeetings = input.meetings.filter((meeting) => {
    if (!meeting.endsAt) {
      return false;
    }

    const endedAt = new Date(meeting.endsAt);
    if (Number.isNaN(endedAt.getTime())) {
      return false;
    }

    return Date.now() - endedAt.getTime() <= 7 * 86400000;
  }).length;

  const meetingFrequencyScore = recentEndedMeetings >= 2 ? 100 : recentEndedMeetings === 1 ? 75 : 45;
  const overdueScore = clampScore(100 - overdueTasks.length * 18);
  const healthScore = clampScore(
    progress * 0.35 +
      meetingFrequencyScore * 0.2 +
      overdueScore * 0.25 +
      participationRate * 0.2,
  );

  const decisionWeight = Math.min(100, input.decisions.length * 18);
  const unresolvedPenalty = Math.min(35, input.unresolvedItems.length * 9);
  const actionWeight = Math.min(100, input.actionItems.length * 14);
  const focusScore = clampScore(
    participationRate * 0.35 + decisionWeight * 0.3 + actionWeight * 0.2 + (100 - unresolvedPenalty) * 0.15,
  );
  const productivityScore = clampScore(
    focusScore * 0.5 + healthScore * 0.3 + Math.min(100, input.messages.length * 6) * 0.2,
  );

  const deadlineDays = getDaysUntil(input.projectEndDate);
  const risks: string[] = [];

  if (deadlineDays !== null && deadlineDays <= 3) {
    risks.push(`발표까지 ${formatRelativeDays(Math.max(deadlineDays, 0))} 남았습니다.`);
  }
  if (overdueTasks.length > 0) {
    risks.push(`연체 업무 ${overdueTasks.length}개가 남아 있습니다.`);
  }
  if (unassignedTasks.length > 0) {
    risks.push(`담당자 없는 업무 ${unassignedTasks.length}개를 배정해야 합니다.`);
  }
  if (participationRate < 70) {
    risks.push("회의 참여율이 낮아 다음 회의에서 역할 확인이 필요합니다.");
  }
  if (recentEndedMeetings === 0) {
    risks.push("최근 회의 빈도가 낮아 빠른 체크인 회의가 필요합니다.");
  }

  const recommendationPool = [
    ...input.actionItems
      .filter((item) => !item.transferred)
      .map((item) => item.title),
    ...input.unresolvedItems.map((item) => item.replace(/결정$/, "").trim()),
    ...unassignedTasks.map((task) => `${task.title} 담당자 지정`),
  ].filter(Boolean);

  const nextActions = Array.from(new Set(recommendationPool)).slice(0, 3);
  if (nextActions.length === 0) {
    nextActions.push("PPT 초안 작성", "발표 순서 결정", "디자인 검토");
  }

  let productivityMessage = "안정적인 회의였습니다.";
  if (productivityScore >= 90) {
    productivityMessage = "아주 생산적인 회의였습니다.";
  } else if (productivityScore >= 75) {
    productivityMessage = "핵심 안건이 잘 정리된 회의였습니다.";
  } else if (productivityScore < 60) {
    productivityMessage = "다음 회의에서는 결정 속도를 조금 더 높일 필요가 있습니다.";
  }

  const timeline: string[] = [`${formatTimelineTime(input.meeting.startsAt)} 회의 시작`];
  const sortedMessages = [...input.messages].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  sortedMessages.slice(0, Math.min(2, sortedMessages.length)).forEach((message, index) => {
    const label =
      index === 0
        ? input.decisions[0] ?? "핵심 안건 논의 시작"
        : input.decisions[index] ?? input.actionItems[index - 1]?.title ?? "역할 분배 논의";
    timeline.push(`${formatTimelineTime(message.createdAt)} ${label}`);
  });

  if (input.decisions.length > 2) {
    timeline.push(`${formatTimelineTime(sortedMessages.at(-1)?.createdAt)} ${input.decisions[2]}`);
  }

  timeline.push(`${formatTimelineTime(input.meeting.endsAt)} 회의 종료`);

  return {
    participationRate,
    participationStars,
    focusScore,
    decisionCount: input.decisions.length,
    unresolvedCount: input.unresolvedItems.length,
    generatedTaskCount: input.actionItems.length,
    healthScore,
    risks: risks.slice(0, 4),
    nextActions: nextActions.slice(0, 3),
    productivityScore,
    productivityMessage,
    timeline: Array.from(new Set(timeline)).slice(0, 4),
  } satisfies AssistantFeedback;
}

function applyImportedActionItems(
  items: MeetingActionItem[],
  imported: Array<{ key: string; taskId: string | null }>,
) {
  const importedMap = new Map(imported.map((item) => [item.key, item]));

  return items.map((item, index) => {
    const match = importedMap.get(buildActionKey(index));
    if (!match) {
      return item;
    }

    return {
      ...item,
      transferred: true,
      taskId: match.taskId ?? null,
    };
  });
}

export function MeetingRoomSheet({
  currentMember,
  isDemo,
  meeting,
  members,
  tasks,
  meetings,
  onClose,
  onImportActionItems,
  onMeetingUpdated,
  projectEndDate,
  projectId,
}: {
  currentMember: TeamMember | null;
  isDemo: boolean;
  meeting: ConfirmedMeeting;
  members: TeamMember[];
  tasks: Task[];
  meetings: ConfirmedMeeting[];
  onClose: () => void;
  onImportActionItems: (
    meeting: ConfirmedMeeting,
    items: Array<{ key: string; item: MeetingActionItem }>,
  ) => Promise<ImportResult>;
  onMeetingUpdated: (meeting: ConfirmedMeeting) => void;
  projectEndDate?: string;
  projectId: string;
}) {
  const [messages, setMessages] = useState<MeetingMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [isLoading, setIsLoading] = useState(!isDemo);
  const [isSending, setIsSending] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [meetingNote, setMeetingNote] = useState<MeetingNote | null>(null);
  const [noteLoadStatus, setNoteLoadStatus] = useState<
    "idle" | "loading" | "empty" | "error" | "success"
  >("idle");
  const [noteLoadMessage, setNoteLoadMessage] = useState("");
  const [agenda, setAgenda] = useState(meeting.agenda ?? "");
  const [pinnedMessages, setPinnedMessages] = useState<MeetingMessage[]>(
    meeting.pinnedMessages ?? [],
  );
  const [isEndConfirmOpen, setIsEndConfirmOpen] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<AnalysisStep>(0);
  const [toastMessage, setToastMessage] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isUpdatingMessageId, setIsUpdatingMessageId] = useState<string | null>(null);
  const [isDeletingMessageId, setIsDeletingMessageId] = useState<string | null>(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [isSummaryEditing, setIsSummaryEditing] = useState(false);
  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [actionItemDrafts, setActionItemDrafts] = useState<MeetingActionItem[]>([]);
  const [selectedActionKeys, setSelectedActionKeys] = useState<string[]>([]);
  const [isSavingActionItems, setIsSavingActionItems] = useState(false);
  const [showCompletionCelebration, setShowCompletionCelebration] = useState(false);
  const channelRef = useRef<{ unsubscribe: () => void } | null>(null);
  const subscribedMeetingIdRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);

  const meetingStatus = meeting.status;
  const isMeetingEnded = meetingStatus === "ended";
  const decisions = useMemo(
    () => meetingNote?.aiDecisions ?? meeting.aiDecisions ?? [],
    [meeting.aiDecisions, meetingNote?.aiDecisions],
  );
  const unresolvedItems = useMemo(
    () => meetingNote?.aiUnresolvedItems ?? meeting.aiUnresolvedItems ?? [],
    [meeting.aiUnresolvedItems, meetingNote?.aiUnresolvedItems],
  );
  const summaryText = meetingNote?.aiSummary ?? meeting.aiSummary ?? null;
  const actionItems = useMemo(
    () =>
      (meetingNote?.aiActionItems ?? meeting.aiActionItems ?? []).map(normalizeActionItem),
    [meeting.aiActionItems, meetingNote?.aiActionItems],
  );
  const canEndMeeting = meetingStatus === "inProgress" && !summaryText;
  const participantMembers = useMemo(
    () => members.filter((member) => member.status === "active"),
    [members],
  );
  const importedActionKeys = useMemo(
    () =>
      actionItemDrafts.flatMap((item, index) =>
        item.transferred ? [buildActionKey(index)] : [],
      ),
    [actionItemDrafts],
  );
  const selectedActionItems = useMemo(
    () =>
      actionItemDrafts.flatMap((item, index) => {
        const key = buildActionKey(index);
        return selectedActionKeys.includes(key) ? [{ key, item }] : [];
      }),
    [actionItemDrafts, selectedActionKeys],
  );
  const assistantFeedback = useMemo(
    () =>
      buildAssistantFeedback({
        meeting,
        members,
        tasks,
        meetings,
        messages,
        decisions,
        unresolvedItems,
        actionItems: actionItemDrafts,
        projectEndDate,
      }),
    [
      actionItemDrafts,
      decisions,
      meeting,
      meetings,
      members,
      messages,
      projectEndDate,
      tasks,
      unresolvedItems,
    ],
  );

  useEffect(() => {
    setSelectedActionKeys(
      actionItems.flatMap((item, index) => (item.transferred ? [] : [buildActionKey(index)])),
    );
    setActionItemDrafts(actionItems);
  }, [meeting.id, actionItems]);

  useEffect(() => {
    setSummaryDraft(summaryText ?? "");
  }, [summaryText]);

  useEffect(() => {
    setAgenda(meeting.agenda ?? "");
    setPinnedMessages(meeting.pinnedMessages ?? []);
  }, [meeting.agenda, meeting.id, meeting.pinnedMessages]);

  useEffect(() => {
    if (!meetingNote) {
      return;
    }

    setAgenda(meetingNote.agenda ?? "");
    setPinnedMessages(meetingNote.pinnedMessages);
  }, [meetingNote]);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToastMessage("");
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    if (!showCompletionCelebration) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowCompletionCelebration(false);
    }, 2200);

    return () => window.clearTimeout(timeout);
  }, [showCompletionCelebration]);

  useEffect(() => {
    if (isMeetingEnded || isSending) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    if (!window.matchMedia("(pointer: fine)").matches) {
      return;
    }

    messageInputRef.current?.focus();
  }, [isMeetingEnded, isSending, meeting.id]);

  useEffect(() => {
    if (isDemo || !isUuid(meeting.id)) {
      setMeetingNote(null);
      setNoteLoadStatus("idle");
      setNoteLoadMessage("");
      return;
    }

    let cancelled = false;

    const loadMeetingNote = async () => {
      setNoteLoadStatus("loading");
      setNoteLoadMessage("회의록을 불러오는 중입니다.");

      const result = await getMeetingNoteByMeetingId(meeting.id);

      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setMeetingNote(null);
        setNoteLoadStatus("error");
        setNoteLoadMessage(result.message);
        return;
      }

      if (!result.data) {
        setMeetingNote(null);
        setNoteLoadStatus("empty");
        setNoteLoadMessage("저장된 회의록이 아직 없습니다.");
        return;
      }

      setMeetingNote(mapMeetingNoteRowToMeetingNote(result.data));
      setNoteLoadStatus("success");
      setNoteLoadMessage("저장된 회의록을 복원했습니다.");
    };

    void loadMeetingNote();

    return () => {
      cancelled = true;
    };
  }, [isDemo, meeting.id]);

  useEffect(() => {
    if (isDemo) {
      setMessages(
        DEMO_MESSAGES.map((message, index) => ({
          ...message,
          id: `${meeting.id}-demo-${index}`,
          meetingId: meeting.id,
        })),
      );
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadMessages = async () => {
      setIsLoading(true);
      const result = await getMeetingMessages(meeting.id);

      if (cancelled) {
        return;
      }

      setIsLoading(false);

      if (!result.ok || !result.data) {
        setStatusMessage(result.message);
        return;
      }

      setMessages(dedupeMessages(mapMeetingMessageRowsToMeetingMessages(result.data)));
      setStatusMessage("");
    };

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [isDemo, meeting.id]);

  useEffect(() => {
    if (isDemo) {
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return;
    }

    if (subscribedMeetingIdRef.current === meeting.id && channelRef.current) {
      return;
    }

    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }

    const channel = supabase
      .channel(`meeting-messages-${meeting.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "meeting_messages",
          filter: `meeting_id=eq.${meeting.id}`,
        },
        (payload) => {
          const incoming = payload.new as {
            id: string;
            meeting_id: string;
            member_id: string | null;
            sender_name: string;
            message: string;
            created_at: string;
          };

          setMessages((current) =>
            dedupeMessages([
              ...current,
              {
                id: incoming.id,
                meetingId: incoming.meeting_id,
                memberId: incoming.member_id,
                senderName: incoming.sender_name,
                message: incoming.message,
                createdAt: incoming.created_at,
              },
            ]),
          );
        },
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(status, error);
          setStatusMessage("회의 채팅 실시간 연결 상태를 확인해 주세요.");
        }
      });

    channelRef.current = channel;
    subscribedMeetingIdRef.current = meeting.id;

    return () => {
      subscribedMeetingIdRef.current = null;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [isDemo, meeting.id]);

  const focusMessageInput = () => {
    const input = messageInputRef.current;
    if (!input || input.disabled || isMeetingEnded) {
      return;
    }

    input.focus();
  };

  const syncMeetingMeta = (
    overrides?: {
      agenda?: string;
      pinnedMessages?: MeetingMessage[];
      aiSummary?: string | null;
      aiDecisions?: string[];
      aiUnresolvedItems?: string[];
      aiActionItems?: MeetingActionItem[];
      title?: string;
      transcript?: string;
    },
  ) => {
    if (isDemo || !isUuid(meeting.id)) {
      return Promise.resolve<MeetingNote | null>(null);
    }

    const nextAgenda = overrides?.agenda ?? agenda;
    const nextPinnedMessages = overrides?.pinnedMessages ?? pinnedMessages;
    const nextTranscript = overrides?.transcript ?? buildTranscript(messages);
    const nextUnresolvedItems =
      overrides?.aiUnresolvedItems ??
      meetingNote?.aiUnresolvedItems ??
      meeting.aiUnresolvedItems ??
      [];

    return createMeetingNote({
      teamId: projectId,
      meetingId: meeting.id,
      title: overrides?.title ?? meetingNote?.title ?? `${meeting.title} 회의록`,
      content: serializeMeetingNoteContent({
        transcript: nextTranscript,
        agenda: nextAgenda,
        pinnedMessages: nextPinnedMessages,
        aiUnresolvedItems: nextUnresolvedItems,
      }),
      aiSummary: overrides?.aiSummary ?? meetingNote?.aiSummary ?? meeting.aiSummary ?? null,
      aiDecisions:
        overrides?.aiDecisions ?? meetingNote?.aiDecisions ?? meeting.aiDecisions ?? [],
      aiActionItems:
        overrides?.aiActionItems ??
        meetingNote?.aiActionItems ??
        meeting.aiActionItems ??
        [],
    }).then((result) => {
      if (!result.ok || !result.data) {
        setStatusMessage(result.message);
        return null;
      }

      const savedNote = mapMeetingNoteRowToMeetingNote(result.data);
      setMeetingNote(savedNote);
      setNoteLoadStatus("success");
      setNoteLoadMessage("저장된 회의록을 복원했습니다.");
      onMeetingUpdated({
        ...meeting,
        agenda: savedNote.agenda,
        aiSummary: savedNote.aiSummary ?? undefined,
        aiDecisions: savedNote.aiDecisions,
        aiUnresolvedItems: savedNote.aiUnresolvedItems,
        aiActionItems: savedNote.aiActionItems,
        noteId: savedNote.id,
        pinnedMessages: savedNote.pinnedMessages,
      });
      return savedNote;
    });
  };

  const handleCopyMessage = async (message: MeetingMessage) => {
    try {
      await navigator.clipboard.writeText(message.message);
      setToastMessage("메시지를 복사했습니다.");
    } catch {
      setStatusMessage("메시지 복사에 실패했습니다.");
    }
  };

  const handleTogglePin = async (targetMessage: MeetingMessage) => {
    const isPinned = pinnedMessages.some((message) => message.id === targetMessage.id);
    const nextPinnedMessages = isPinned
      ? pinnedMessages.filter((message) => message.id !== targetMessage.id)
      : [targetMessage, ...pinnedMessages];

    setPinnedMessages(nextPinnedMessages);

    if (!isDemo) {
      const savedNote = await syncMeetingMeta({
        pinnedMessages: nextPinnedMessages,
      });

      if (!savedNote) {
        setPinnedMessages(pinnedMessages);
        return;
      }
    } else {
      onMeetingUpdated({
        ...meeting,
        pinnedMessages: nextPinnedMessages,
      });
    }

    setToastMessage(isPinned ? "고정을 해제했습니다." : "메시지를 고정했습니다.");
  };

  const handleSaveAgenda = async () => {
    const nextAgenda = agenda.trim();

    if (isDemo) {
      onMeetingUpdated({
        ...meeting,
        agenda: nextAgenda || null,
      });
      setStatusMessage("안건을 반영했습니다.");
      return;
    }

    const savedNote = await syncMeetingMeta({
      agenda: nextAgenda,
    });

    if (savedNote) {
      setAgenda(savedNote.agenda ?? "");
      setStatusMessage("안건을 저장했습니다.");
    }
  };

  const handleSendMessage = async () => {
    const trimmedMessage = messageInput.trim();
    if (!trimmedMessage || isSending || isMeetingEnded) {
      return;
    }

    if (isDemo) {
      const demoMessage: MeetingMessage = {
        id: `${meeting.id}-demo-${Date.now()}`,
        meetingId: meeting.id,
        memberId: currentMember?.id ?? null,
        senderName: currentMember?.name ?? "익명 사용자",
        message: trimmedMessage,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, demoMessage]);
      setMessageInput("");
      focusMessageInput();
      return;
    }

    if (!currentMember) {
      setStatusMessage(
        "실제 채팅은 로그인과 팀원 연결이 완료된 상태에서만 전송할 수 있습니다.",
      );
      return;
    }

    setIsSending(true);
    const result = await createMeetingMessage({
      meetingId: meeting.id,
      memberId: currentMember.id,
      senderName: currentMember.name,
      message: trimmedMessage,
    });
    setIsSending(false);

    if (!result.ok || !result.data) {
      setStatusMessage(result.message);
      focusMessageInput();
      return;
    }

    const savedMessage = result.data;

    setMessages((current) =>
      dedupeMessages([
        ...current,
        {
          id: savedMessage.id,
          meetingId: savedMessage.meeting_id,
          memberId: savedMessage.member_id,
          senderName: savedMessage.sender_name,
          message: savedMessage.message,
          createdAt: savedMessage.created_at,
        },
      ]),
    );
    setMessageInput("");
    setStatusMessage("");
    focusMessageInput();
  };

  const handleMessageKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();

    if (isSending || isMeetingEnded || !messageInput.trim()) {
      return;
    }

    void handleSendMessage();
  };

  const handleStartEdit = (message: MeetingMessage) => {
    setEditingMessageId(message.id);
    setEditingValue(message.message);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingValue("");
  };

  const handleSaveEdit = async (message: MeetingMessage) => {
    const trimmedValue = editingValue.trim();
    if (!trimmedValue || isUpdatingMessageId) {
      return;
    }

    if (isDemo) {
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, message: trimmedValue } : item,
        ),
      );
      setPinnedMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, message: trimmedValue } : item,
        ),
      );
      handleCancelEdit();
      setToastMessage("메시지를 수정했습니다.");
      return;
    }

    setIsUpdatingMessageId(message.id);
    const result = await updateMeetingMessage(message.id, {
      message: trimmedValue,
    });
    setIsUpdatingMessageId(null);

    if (!result.ok || !result.data) {
      setStatusMessage(result.message);
      return;
    }

    const updatedMessage: MeetingMessage = {
      id: result.data.id,
      meetingId: result.data.meeting_id,
      memberId: result.data.member_id,
      senderName: result.data.sender_name,
      message: result.data.message,
      createdAt: result.data.created_at,
    };

    const nextMessages = messages.map((item) =>
      item.id === message.id ? updatedMessage : item,
    );
    const nextPinnedMessages = pinnedMessages.map((item) =>
      item.id === message.id ? updatedMessage : item,
    );

    setMessages(nextMessages);
    setPinnedMessages(nextPinnedMessages);
    await syncMeetingMeta({
      pinnedMessages: nextPinnedMessages,
      transcript: buildTranscript(nextMessages),
    });
    handleCancelEdit();
    setToastMessage("메시지를 수정했습니다.");
  };

  const handleDeleteMessageAction = async (message: MeetingMessage) => {
    if (isDeletingMessageId) {
      return;
    }

    if (isDemo) {
      setMessages((current) => current.filter((item) => item.id !== message.id));
      const nextPinnedMessages = pinnedMessages.filter((item) => item.id !== message.id);
      setPinnedMessages(nextPinnedMessages);
      setToastMessage("메시지를 삭제했습니다.");
      return;
    }

    setIsDeletingMessageId(message.id);
    const result = await deleteMeetingMessage(message.id);
    setIsDeletingMessageId(null);

    if (!result.ok) {
      setStatusMessage(result.message);
      return;
    }

    const nextMessages = messages.filter((item) => item.id !== message.id);
    const nextPinnedMessages = pinnedMessages.filter((item) => item.id !== message.id);
    setMessages(nextMessages);
    setPinnedMessages(nextPinnedMessages);
    if (editingMessageId === message.id) {
      handleCancelEdit();
    }
    await syncMeetingMeta({
      pinnedMessages: nextPinnedMessages,
      transcript: buildTranscript(nextMessages),
    });
    setToastMessage("메시지를 삭제했습니다.");
  };

  const handleSaveSummary = async () => {
    const nextSummary = summaryDraft.trim();
    if (!nextSummary || isSavingSummary) {
      return;
    }

    if (isDemo) {
      setMeetingNote((current) =>
        current
          ? {
              ...current,
              aiSummary: nextSummary,
            }
          : current,
      );
      onMeetingUpdated({
        ...meeting,
        aiSummary: nextSummary,
      });
      setIsSummaryEditing(false);
      setStatusMessage("AI 요약을 저장했습니다.");
      return;
    }

    setIsSavingSummary(true);
    const savedNote = await syncMeetingMeta({
      aiSummary: nextSummary,
    });
    setIsSavingSummary(false);

    if (savedNote) {
      setSummaryDraft(savedNote.aiSummary ?? "");
      setIsSummaryEditing(false);
      setStatusMessage("회의록 요약을 업데이트했습니다.");
    }
  };

  const handleActionItemFieldChange = (
    index: number,
    field: "assigneeName" | "priority" | "dueAt",
    value: string,
  ) => {
    setActionItemDrafts((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }

        if (field === "assigneeName") {
          return { ...item, assigneeName: value };
        }

        if (field === "priority") {
          return { ...item, priority: value as TaskPriority };
        }

        return { ...item, dueAt: value ? new Date(value).toISOString() : null };
      }),
    );
  };

  const handleSaveActionItemDrafts = async () => {
    if (isSavingActionItems) {
      return;
    }

    if (isDemo) {
      setMeetingNote((current) =>
        current
          ? {
              ...current,
              aiActionItems: actionItemDrafts,
            }
          : current,
      );
      onMeetingUpdated({
        ...meeting,
        aiActionItems: actionItemDrafts,
      });
      setStatusMessage("Action Item 후보를 저장했습니다.");
      return;
    }

    setIsSavingActionItems(true);
    const savedNote = await syncMeetingMeta({
      aiActionItems: actionItemDrafts,
    });
    setIsSavingActionItems(false);

    if (savedNote) {
      setActionItemDrafts(savedNote.aiActionItems.map(normalizeActionItem));
      setStatusMessage("Action Item 후보를 업데이트했습니다.");
    }
  };

  const handleDownloadPdf = () => {
    const attendees = participantMembers.map((member) => member.name).join(", ") || "참석자 없음";
    const actionItemLines =
      actionItemDrafts.length > 0
        ? actionItemDrafts
            .map((item) => {
              const priority = PRIORITY_META[item.priority ?? "medium"].label;
              return `<li>${escapeHtml(item.title)} / 담당: ${escapeHtml(
                item.assigneeName || "미정",
              )} / 우선순위: ${priority} / 마감: ${escapeHtml(
                formatActionDate(item.dueAt),
              )}</li>`;
            })
            .join("")
        : "<li>등록된 Action Item이 없습니다.</li>";
    const decisionLines =
      decisions.length > 0
        ? decisions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
        : "<li>결정된 사항이 없습니다.</li>";
    const unresolvedLines =
      unresolvedItems.length > 0
        ? unresolvedItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
        : "<li>미결정 사항이 없습니다.</li>";

    const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(meeting.title)} 회의록</title>
    <style>
      body { font-family: "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; background: #eef4fb; margin: 0; color: #0f172a; }
      .page { width: 794px; margin: 0 auto; background: white; min-height: 1123px; padding: 48px; box-sizing: border-box; }
      .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
      .logo { width: 52px; height: 52px; border-radius: 18px; background: linear-gradient(135deg, #1e70e6, #58a6ff); color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 20px; }
      .brand h1 { margin: 0; font-size: 28px; }
      .brand p { margin: 4px 0 0; color: #475569; font-size: 14px; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 24px 0; }
      .card { border: 1px solid #dbe7f5; border-radius: 18px; padding: 16px 18px; background: #f8fbff; }
      .card strong { display: block; margin-bottom: 8px; font-size: 13px; color: #1e70e6; }
      .section { margin-top: 20px; border: 1px solid #e2e8f0; border-radius: 18px; padding: 18px; }
      .section h2 { margin: 0 0 12px; font-size: 18px; }
      .section p, .section li { font-size: 14px; line-height: 1.7; color: #334155; }
      ul { margin: 0; padding-left: 20px; }
      .footer { margin-top: 28px; padding: 16px 18px; border-radius: 18px; background: #1e70e6; color: white; font-size: 14px; line-height: 1.7; }
      @media print {
        body { background: white; }
        .page { margin: 0; width: auto; min-height: auto; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="brand">
        <div class="logo">C</div>
        <div>
          <h1>CarryMate</h1>
          <p>AI 회의록 PDF</p>
        </div>
      </div>

      <div class="meta">
        <div class="card"><strong>회의 제목</strong>${escapeHtml(meeting.title)}</div>
        <div class="card"><strong>회의 시간</strong>${escapeHtml(
          `${meeting.dateLabel} · ${meeting.timeRange}`,
        )}</div>
        <div class="card"><strong>참석자</strong>${escapeHtml(attendees)}</div>
        <div class="card"><strong>안건</strong>${escapeHtml(agenda.trim() || "안건 없음")}</div>
      </div>

      <div class="section">
        <h2>AI 요약</h2>
        <p>${escapeHtml(summaryDraft.trim() || summaryText || "요약 없음")}</p>
      </div>

      <div class="section">
        <h2>결정사항</h2>
        <ul>${decisionLines}</ul>
      </div>

      <div class="section">
        <h2>미결정사항</h2>
        <ul>${unresolvedLines}</ul>
      </div>

      <div class="section">
        <h2>Action Items</h2>
        <ul>${actionItemLines}</ul>
      </div>

      <div class="footer">
        CarryMate generated this meeting note for faster team follow-up. 공유 전에 담당자와 마감일을 한 번 더 확인해 주세요.
      </div>
    </div>
    <script>
      window.addEventListener("load", () => {
        window.print();
      });
    </script>
  </body>
</html>`;

    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setStatusMessage("PDF 창을 열지 못했습니다. 팝업 차단을 확인해 주세요.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handleEndMeeting = async () => {
    if (isEnding || !canEndMeeting) {
      return;
    }

    setIsEnding(true);
    setAnalysisStep(1);

    if (isDemo) {
      const demoSummary = createDemoSummary(messages);
      const normalizedActionItems = demoSummary.actionItems.map(normalizeActionItem);
      const updatedMeeting: ConfirmedMeeting = {
        ...meeting,
        status: "ended",
        isEnded: true,
        endsAt: new Date().toISOString(),
        agenda: agenda.trim() || null,
        pinnedMessages,
        aiSummary: demoSummary.summary,
        aiDecisions: demoSummary.decisions,
        aiUnresolvedItems: demoSummary.unresolvedItems,
        aiActionItems: normalizedActionItems,
      };

      setSummaryDraft(demoSummary.summary);
      setActionItemDrafts(normalizedActionItems);
      setAnalysisStep(2);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      setAnalysisStep(3);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      setAnalysisStep(4);
      await new Promise((resolve) => window.setTimeout(resolve, 400));

      onMeetingUpdated(updatedMeeting);
      setShowCompletionCelebration(true);
      setStatusMessage("데모 회의를 종료하고 AI 회의록을 생성했습니다.");
      setIsEnding(false);
      setAnalysisStep(0);
      setIsEndConfirmOpen(false);
      return;
    }

    const endedAt = new Date().toISOString();
    const endResult = await endMeeting(meeting.id, endedAt);

    if (!endResult.ok) {
      setStatusMessage(endResult.message);
      setIsEnding(false);
      setAnalysisStep(0);
      return;
    }

    const messagesResult = await getMeetingMessages(meeting.id);

    if (!messagesResult.ok || !messagesResult.data) {
      setStatusMessage(messagesResult.message);
      setIsEnding(false);
      setAnalysisStep(0);
      return;
    }

    const persistedMessages = mapMeetingMessageRowsToMeetingMessages(messagesResult.data);
    setMessages(dedupeMessages(persistedMessages));

    const transcript = buildTranscript(persistedMessages);
    const senders = Array.from(
      new Set(
        persistedMessages.length > 0
          ? persistedMessages.map((message) => message.senderName)
          : members.map((member) => member.name),
      ),
    );

    const aiResponse = await fetch("/api/meeting-ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meetingId: meeting.id,
        title: meeting.title,
        content: transcript,
        members: senders,
      }),
    });

    const aiPayload = ((await aiResponse.json()) as MeetingAiPayload | undefined) ?? undefined;

    setAnalysisStep(2);

    if (!aiResponse.ok || !aiPayload?.summary) {
      setStatusMessage(aiPayload?.error ?? "AI 회의 요약 생성에 실패했습니다.");
      setIsEnding(false);
      setAnalysisStep(0);
      return;
    }

    const nextActionItems = (aiPayload.actionItems ?? []).map(normalizeActionItem);
    setAnalysisStep(3);

    const noteResult = await createMeetingNote({
      teamId: projectId,
      meetingId: meeting.id,
      title: `${meeting.title} 회의록`,
      content: serializeMeetingNoteContent({
        transcript,
        agenda: agenda.trim(),
        pinnedMessages,
        aiUnresolvedItems: aiPayload.unresolvedItems ?? [],
      }),
      aiSummary: aiPayload.summary,
      aiDecisions: aiPayload.decisions ?? [],
      aiActionItems: nextActionItems,
    });

    setAnalysisStep(4);

    if (!noteResult.ok || !noteResult.data) {
      setStatusMessage(noteResult.message);
      setIsEnding(false);
      setAnalysisStep(0);
      return;
    }

    const savedNote = mapMeetingNoteRowToMeetingNote(noteResult.data);
    setMeetingNote(savedNote);
    setSummaryDraft(savedNote.aiSummary ?? "");
    setActionItemDrafts(savedNote.aiActionItems.map(normalizeActionItem));
    setNoteLoadStatus("success");
    setNoteLoadMessage("저장된 회의록을 복원했습니다.");

    onMeetingUpdated({
      ...meeting,
      status: "ended",
      endsAt: endResult.data?.ends_at ?? endedAt,
      isEnded: true,
      agenda: savedNote.agenda,
      aiSummary: savedNote.aiSummary ?? aiPayload.summary,
      aiDecisions: savedNote.aiDecisions,
      aiUnresolvedItems: savedNote.aiUnresolvedItems,
      aiActionItems: savedNote.aiActionItems,
      noteId: savedNote.id,
      pinnedMessages: savedNote.pinnedMessages,
    });
    setShowCompletionCelebration(true);
    setStatusMessage("회의 종료와 AI 회의록 저장이 완료되었습니다.");
    setIsEnding(false);
    setAnalysisStep(0);
    setIsEndConfirmOpen(false);
  };

  const handleImportTasks = async () => {
    if (selectedActionItems.length === 0 || isImporting) {
      return;
    }

    setIsImporting(true);
    const result = await onImportActionItems(meeting, selectedActionItems);

    let nextMessage = result.message;

    if (result.imported.length > 0) {
      const updatedActionItems = applyImportedActionItems(actionItemDrafts, result.imported);

      if (!isDemo) {
        const savedNote = await syncMeetingMeta({
          aiActionItems: updatedActionItems,
        });

        if (!savedNote) {
          nextMessage = `${nextMessage} 회의록 전송 상태 저장에 실패했습니다.`;
        } else {
          setActionItemDrafts(savedNote.aiActionItems.map(normalizeActionItem));
        }
      } else {
        setActionItemDrafts(updatedActionItems);
        setMeetingNote((current) =>
          current
            ? {
                ...current,
                aiActionItems: updatedActionItems,
              }
            : current,
        );
        onMeetingUpdated({
          ...meeting,
          aiActionItems: updatedActionItems,
        });
      }

      setSelectedActionKeys((current) =>
        current.filter((key) => !result.imported.some((item) => item.key === key)),
      );
    }

    setIsImporting(false);
    setStatusMessage(nextMessage);
  };

  const statusMeta = STATUS_META[meetingStatus];

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/35 px-4 pb-6 pt-10">
      {toastMessage ? (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#1f2937] px-4 py-2 text-[12px] font-semibold text-white shadow-lg">
          {toastMessage}
        </div>
      ) : null}
      {showCompletionCelebration ? (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-6">
          <div className="w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-emerald-200 bg-white shadow-[0_24px_80px_rgba(30,112,230,0.18)]">
            <div className="bg-gradient-to-r from-[#1e70e6] via-[#4ea2ff] to-[#7bc4ff] px-5 py-4 text-white">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                CarryMate AI
              </p>
              <p className="mt-2 text-lg font-semibold">회의 완료</p>
            </div>
            <div className="grid grid-cols-3 gap-2 px-4 py-4 text-center">
              {["회의 완료", "AI 분석 완료", "업무 생성 완료"].map((label, index) => (
                <div
                  key={label}
                  className="rounded-2xl bg-[#f4faff] px-3 py-3 text-[11px] font-semibold text-[#1559b7]"
                  style={{ animationDelay: `${index * 120}ms` }}
                >
                  <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm shadow-soft">
                    ✓
                  </div>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isEndConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-6">
          <div className="w-full max-w-sm rounded-[1.75rem] bg-white p-5 shadow-soft">
            <h3 className="text-base font-semibold text-ink">회의를 종료하시겠습니까?</h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              종료 후 AI가 회의를 분석하고 회의록과 Action Item 후보를 생성합니다.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={isEnding}
                onClick={() => setIsEndConfirmOpen(false)}
                className="flex-1 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-ink"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isEnding}
                onClick={() => {
                  void handleEndMeeting();
                }}
                className="flex-1 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-brand disabled:opacity-60"
              >
                {isEnding ? "종료 중..." : "회의 종료"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-md flex-col rounded-[2rem] border border-line bg-white shadow-soft">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
              Team Meeting
            </p>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="text-lg font-semibold text-ink">{meeting.title}</h2>
              <span
                className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusMeta.className}`}
              >
                {statusMeta.label}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-muted">
              {meeting.dateLabel} · {meeting.timeRange}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-canvas px-3 py-1 text-sm font-medium text-muted"
          >
            닫기
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
          <div className="rounded-2xl border border-line bg-canvas px-4 py-3 text-[12px] leading-6 text-muted">
            {statusMessage ||
              (isMeetingEnded
                ? "종료된 회의입니다. 기존 메시지와 AI 회의록은 계속 확인할 수 있습니다."
                : "채팅으로 회의를 정리하고, 종료 시 AI가 요약과 후속 업무 후보를 생성합니다.")}
          </div>

          {!isDemo ? (
            <div className="mt-3 rounded-2xl border border-line bg-white px-4 py-3 text-[12px] leading-6 text-muted">
              {noteLoadStatus === "loading"
                ? "회의록 조회 중"
                : noteLoadStatus === "success"
                  ? noteLoadMessage
                  : noteLoadStatus === "empty"
                    ? "회의록 없음"
                    : noteLoadStatus === "error"
                      ? `회의록 조회 실패: ${noteLoadMessage}`
                      : "회의록을 아직 확인하지 않았습니다."}
            </div>
          ) : null}

          <section className="mt-4 rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">안건</p>
                <p className="mt-1 text-[12px] leading-5 text-muted">
                  회의에서 먼저 정리할 내용을 간단히 적어두세요.
                </p>
              </div>
              {!isMeetingEnded ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleSaveAgenda();
                  }}
                  className="rounded-2xl border border-line bg-white px-4 py-2 text-[12px] font-semibold text-ink shadow-soft"
                >
                  안건 저장
                </button>
              ) : null}
            </div>
            <textarea
              value={agenda}
              onChange={(event) => setAgenda(event.target.value)}
              disabled={isMeetingEnded}
              rows={3}
              placeholder="예: 발표 순서 확인, 디자인 방향 결정, 마감 전 역할 분담"
              className="mt-3 w-full resize-none rounded-2xl border border-line bg-white px-4 py-3 text-sm outline-none transition focus:border-brand disabled:bg-canvas"
            />
          </section>

          <section className="mt-4 rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
            <p className="text-sm font-semibold text-ink">참석자</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {participantMembers.map((member) => {
                const isMe = Boolean(currentMember?.id && currentMember.id === member.id);

                return (
                  <span
                    key={member.id}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                      isMe ? "bg-blue-50 text-brand" : "bg-canvas text-muted"
                    }`}
                  >
                    {member.name}
                    {isMe ? " · 나" : ""}
                  </span>
                );
              })}
            </div>
          </section>

          {pinnedMessages.length > 0 ? (
            <section className="mt-4 rounded-[1.75rem] border border-line bg-[#faf9ff] p-4 shadow-soft">
              <p className="text-sm font-semibold text-ink">고정 메시지</p>
              <div className="mt-3 space-y-3">
                {pinnedMessages.map((message) => (
                  <div
                    key={message.id}
                    className="rounded-2xl border border-[#e8e3ff] bg-white px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[12px] font-semibold text-ink">{message.senderName}</p>
                      <p className="text-[11px] text-muted">
                        {formatMessageTime(message.createdAt)}
                      </p>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-ink">
                      {message.message}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">회의 채팅</h3>
              <span className="rounded-full bg-canvas px-3 py-1 text-[11px] font-semibold text-muted">
                {messages.length}개 메시지
              </span>
            </div>

            <div ref={messageListRef} className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
              {isLoading ? (
                <div className="rounded-2xl border border-line bg-canvas px-4 py-6 text-center text-sm text-muted">
                  메시지를 불러오는 중입니다.
                </div>
              ) : messages.length > 0 ? (
                messages.map((message) => {
                  const isMine = Boolean(currentMember?.id && message.memberId === currentMember.id);
                  const isEditing = editingMessageId === message.id;
                  const isBusy =
                    isUpdatingMessageId === message.id ||
                    isDeletingMessageId === message.id;
                  const canEdit = isMine && !isMeetingEnded;

                  return (
                    <div
                      key={message.id}
                      className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[88%] rounded-2xl border px-4 py-3 ${
                          isMine ? "border-blue-100 bg-blue-50" : "border-line bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[12px] font-semibold text-ink">
                            {message.senderName}
                          </p>
                          <p className="text-[11px] text-muted">
                            {formatMessageTime(message.createdAt)}
                          </p>
                        </div>

                        {isEditing ? (
                          <div className="mt-2">
                            <textarea
                              value={editingValue}
                              onChange={(event) => setEditingValue(event.target.value)}
                              rows={3}
                              className="w-full resize-none rounded-2xl border border-line bg-white px-3 py-2 text-[13px] outline-none transition focus:border-brand"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="rounded-xl border border-line bg-white px-3 py-2 text-[11px] font-semibold text-muted"
                              >
                                취소
                              </button>
                              <button
                                type="button"
                                disabled={!editingValue.trim() || isBusy}
                                onClick={() => {
                                  void handleSaveEdit(message);
                                }}
                                className="rounded-xl bg-brand px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                              >
                                {isUpdatingMessageId === message.id ? "저장 중..." : "저장"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-ink">
                            {message.message}
                          </p>
                        )}

                        {!isEditing ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void handleCopyMessage(message);
                              }}
                              className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-muted"
                            >
                              복사
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void handleTogglePin(message);
                              }}
                              className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-muted"
                            >
                              {pinnedMessages.some((item) => item.id === message.id)
                                ? "고정 해제"
                                : "고정"}
                            </button>
                            {canEdit ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(message)}
                                  className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-muted"
                                >
                                  수정
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => {
                                    void handleDeleteMessageAction(message);
                                  }}
                                  className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-rose-500 disabled:opacity-60"
                                >
                                  {isDeletingMessageId === message.id ? "삭제 중..." : "삭제"}
                                </button>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-[1.75rem] border border-dashed border-line bg-white px-6 py-8 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#eef5ff] text-xl text-brand">
                    대화
                  </div>
                  <p className="mt-3 text-sm font-semibold text-ink">
                    첫 메시지를 보내고
                    <br />
                    회의를 시작해 보세요.
                  </p>
                </div>
              )}
            </div>

            {isMeetingEnded ? (
              <div className="mt-4 rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-muted">
                종료된 회의입니다.
              </div>
            ) : null}

            <div className="mt-4 flex gap-2">
              <textarea
                ref={messageInputRef}
                value={messageInput}
                onChange={(event) => setMessageInput(event.target.value)}
                onKeyDown={handleMessageKeyDown}
                placeholder={
                  isMeetingEnded
                    ? "종료된 회의입니다."
                    : isDemo || currentMember
                      ? "회의 메시지를 입력해 주세요."
                      : "로그인과 팀원 연결 후 채팅을 보낼 수 있습니다."
                }
                disabled={isMeetingEnded || isSending}
                rows={2}
                className="min-w-0 flex-1 resize-none rounded-2xl border border-line bg-white px-4 py-3 text-sm outline-none transition focus:border-brand disabled:bg-canvas"
              />
              <button
                type="button"
                disabled={isMeetingEnded || isSending}
                onClick={() => {
                  void handleSendMessage();
                }}
                className="rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-brand disabled:opacity-60"
              >
                {isSending ? "전송 중..." : "전송"}
              </button>
            </div>
          </section>

          <section className="mt-5 rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">회의 종료 및 AI 분석</p>
                <p className="mt-1 text-[12px] leading-5 text-muted">
                  회의 종료 후 AI 분석 → 회의록 생성 → Tasks 생성 → 완료 순서로 진행됩니다.
                </p>
              </div>
              {summaryText && isMeetingEnded ? (
                <span className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                  회의록 생성 완료
                </span>
              ) : (
                <button
                  type="button"
                  disabled={!canEndMeeting || isEnding}
                  onClick={() => setIsEndConfirmOpen(true)}
                  className="rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-brand disabled:opacity-60"
                >
                  {isEnding ? "종료 중..." : "회의 종료"}
                </button>
              )}
            </div>

            {analysisStep > 0 ? (
              <div className="mt-4 rounded-3xl bg-[#f6faff] p-4">
                {ANALYSIS_STEPS.map((item) => {
                  const isDone = analysisStep > item.step;
                  const isCurrent = analysisStep === item.step;

                  return (
                    <div
                      key={item.step}
                      className={`relative overflow-hidden rounded-2xl border px-4 py-3 ${
                        isCurrent
                          ? "border-blue-200 bg-white shadow-soft"
                          : isDone
                            ? "border-emerald-200 bg-emerald-50"
                            : "border-transparent bg-white/70"
                      } ${item.step === 4 ? "" : "mb-3"}`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ${
                            isDone
                              ? "bg-emerald-100 text-emerald-700"
                              : isCurrent
                                ? "bg-blue-100 text-brand"
                                : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {isDone ? "✓" : item.step}
                        </span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-ink">{item.label}</p>
                          <p className="text-[12px] text-muted">{item.detail}</p>
                        </div>
                      </div>
                      {isCurrent ? (
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-blue-100">
                          <div className="h-full w-1/2 animate-pulse rounded-full bg-brand" />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>

          {summaryText ? (
            <section className="mt-5 space-y-4">
              <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">AI 요약</p>
                    <p className="mt-1 text-[12px] leading-5 text-muted">
                      사용자가 내용을 수정하고 회의록에 다시 저장할 수 있습니다.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {isSummaryEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setSummaryDraft(summaryText ?? "");
                            setIsSummaryEditing(false);
                          }}
                          className="rounded-2xl border border-line bg-white px-3 py-2 text-[11px] font-semibold text-muted"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          disabled={!summaryDraft.trim() || isSavingSummary}
                          onClick={() => {
                            void handleSaveSummary();
                          }}
                          className="rounded-2xl bg-brand px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                        >
                          {isSavingSummary ? "저장 중..." : "수정 저장"}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setIsSummaryEditing(true)}
                          className="rounded-2xl border border-line bg-white px-3 py-2 text-[11px] font-semibold text-ink"
                        >
                          요약 수정
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadPdf}
                          className="rounded-2xl bg-[#0f172a] px-3 py-2 text-[11px] font-semibold text-white"
                        >
                          PDF 다운로드
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {isSummaryEditing ? (
                  <textarea
                    value={summaryDraft}
                    onChange={(event) => setSummaryDraft(event.target.value)}
                    rows={5}
                    className="mt-3 w-full resize-none rounded-2xl border border-line bg-white px-4 py-3 text-[13px] leading-6 text-ink outline-none transition focus:border-brand"
                  />
                ) : (
                  <p className="mt-2 text-[13px] leading-6 text-muted">{summaryDraft}</p>
                )}
                {meetingNote ? (
                  <p className="mt-2 text-[11px] text-muted">
                    생성 시각:{" "}
                    {new Date(meetingNote.createdAt).toLocaleString("ko-KR", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </p>
                ) : null}
              </div>

              <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">CarryMate AI 피드백</p>
                    <p className="mt-1 text-[12px] leading-5 text-muted">
                      회의 종료 직후 참여율, 집중도, 생성 결과를 자동 분석했습니다.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#eef6ff] px-3 py-2 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand">
                      Productivity
                    </p>
                    <p className="text-lg font-semibold text-ink">
                      {assistantFeedback.productivityScore}점
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-[#f8fbff] px-4 py-4">
                    <p className="text-[11px] font-semibold text-brand">회의 참여율</p>
                    <p className="mt-2 text-[18px] font-semibold text-ink">
                      {"★".repeat(assistantFeedback.participationStars)}
                      <span className="ml-2 text-[12px] font-medium text-muted">
                        {assistantFeedback.participationRate}%
                      </span>
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#f8fbff] px-4 py-4">
                    <p className="text-[11px] font-semibold text-brand">집중도</p>
                    <p className="mt-2 text-[18px] font-semibold text-ink">
                      {assistantFeedback.focusScore}점
                    </p>
                  </div>
                  <div className="rounded-2xl bg-canvas px-4 py-4">
                    <p className="text-[11px] font-semibold text-muted">결정 안건</p>
                    <p className="mt-2 text-[18px] font-semibold text-ink">
                      {assistantFeedback.decisionCount}개
                    </p>
                  </div>
                  <div className="rounded-2xl bg-canvas px-4 py-4">
                    <p className="text-[11px] font-semibold text-muted">미결정 안건</p>
                    <p className="mt-2 text-[18px] font-semibold text-ink">
                      {assistantFeedback.unresolvedCount}개
                    </p>
                  </div>
                  <div className="rounded-2xl bg-canvas px-4 py-4">
                    <p className="text-[11px] font-semibold text-muted">생성 업무</p>
                    <p className="mt-2 text-[18px] font-semibold text-ink">
                      {assistantFeedback.generatedTaskCount}개
                    </p>
                  </div>
                  <div className="rounded-2xl bg-canvas px-4 py-4">
                    <p className="text-[11px] font-semibold text-muted">프로젝트 건강도</p>
                    <p className="mt-2 text-[18px] font-semibold text-ink">
                      {assistantFeedback.healthScore}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">프로젝트 건강도</p>
                    <p className="mt-1 text-[12px] leading-5 text-muted">
                      진행률, 회의 빈도, 연체 업무, 참여율을 기준으로 계산했습니다.
                    </p>
                  </div>
                  <div className="relative h-14 w-14">
                    <div
                      className="absolute inset-0 rounded-full bg-[conic-gradient(#1e70e6_var(--health-angle),#e5eefb_0deg)]"
                      style={
                        {
                          "--health-angle": `${assistantFeedback.healthScore * 3.6}deg`,
                        } as CSSProperties
                      }
                    />
                    <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-white text-[13px] font-semibold text-ink">
                      {assistantFeedback.healthScore}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                <p className="text-sm font-semibold text-ink">위험 요소 감지</p>
                <div className="mt-3 space-y-2">
                  {assistantFeedback.risks.length > 0 ? (
                    assistantFeedback.risks.map((risk, index) => (
                      <div
                        key={`${risk}-${index}`}
                        className="rounded-2xl bg-[#fff7f2] px-4 py-3 text-[13px] leading-6 text-[#9a4b15]"
                      >
                        {risk}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl bg-[#f3fbf7] px-4 py-3 text-[13px] leading-6 text-[#1f7a4d]">
                      지금은 뚜렷한 위험 요소가 없습니다.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                <p className="text-sm font-semibold text-ink">AI 다음 행동 추천</p>
                <div className="mt-3 space-y-2">
                  {assistantFeedback.nextActions.map((action, index) => (
                    <div
                      key={`${action}-${index}`}
                      className="rounded-2xl bg-[#f7fbff] px-4 py-3 text-[13px] font-semibold text-[#1559b7]"
                    >
                      {action}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                <p className="text-sm font-semibold text-ink">생산성 점수</p>
                <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-ink">
                  {assistantFeedback.productivityScore}점
                </p>
                <p className="mt-2 text-[13px] leading-6 text-muted">
                  {assistantFeedback.productivityMessage}
                </p>
              </div>

              <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                <p className="text-sm font-semibold text-ink">회의 타임라인</p>
                <div className="mt-3 space-y-3">
                  {assistantFeedback.timeline.map((item, index) => (
                    <div key={`${item}-${index}`} className="flex gap-3">
                      <div className="flex w-14 shrink-0 items-start justify-center">
                        <span className="rounded-full bg-[#eef6ff] px-2 py-1 text-[10px] font-semibold text-brand">
                          {item.split(" ")[0]}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1 rounded-2xl bg-canvas px-4 py-3 text-[13px] leading-6 text-ink">
                        {item.substring(item.indexOf(" ") + 1)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                  <p className="text-sm font-semibold text-ink">AI 결정사항</p>
                  <div className="mt-3 space-y-2">
                    {decisions.length > 0 ? (
                      decisions.map((decision, index) => (
                        <div
                          key={`${decision}-${index}`}
                          className="rounded-2xl bg-canvas px-4 py-3 text-[13px] leading-6 text-muted"
                        >
                          {decision}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl bg-canvas px-4 py-3 text-[13px] leading-6 text-muted">
                        정리된 결정사항이 없습니다.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                  <p className="text-sm font-semibold text-ink">AI 미결정사항</p>
                  <div className="mt-3 space-y-2">
                    {unresolvedItems.length > 0 ? (
                      unresolvedItems.map((item, index) => (
                        <div
                          key={`${item}-${index}`}
                          className="rounded-2xl bg-[#fff8f1] px-4 py-3 text-[13px] leading-6 text-[#9a5b16]"
                        >
                          {item}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl bg-canvas px-4 py-3 text-[13px] leading-6 text-muted">
                        미결정사항이 없습니다.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {meetingNote ? (
                <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                  <p className="text-sm font-semibold text-ink">원본 회의 내용</p>
                  <pre className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-muted">
                    {meetingNote.content}
                  </pre>
                </div>
              ) : null}

              <div className="rounded-[1.75rem] border border-line bg-white p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">Action Item</p>
                    <p className="mt-1 text-[12px] leading-5 text-muted">
                      등록 전에 담당자, 우선순위, 마감일을 수정한 뒤 Tasks로 보낼 수 있습니다.
                    </p>
                  </div>
                  {actionItemDrafts.length > 0 ? (
                    <button
                      type="button"
                      disabled={isSavingActionItems}
                      onClick={() => {
                        void handleSaveActionItemDrafts();
                      }}
                      className="rounded-2xl border border-line bg-white px-3 py-2 text-[11px] font-semibold text-ink disabled:opacity-60"
                    >
                      {isSavingActionItems ? "저장 중..." : "후보 저장"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-3 space-y-3">
                  {actionItemDrafts.length > 0 ? (
                    actionItemDrafts.map((item, index) => {
                      const key = buildActionKey(index);
                      const checked = selectedActionKeys.includes(key);
                      const isTransferred = importedActionKeys.includes(key);
                      const priorityMeta = PRIORITY_META[item.priority ?? "medium"];
                      const dueDateValue = item.dueAt
                        ? new Date(item.dueAt).toISOString().slice(0, 10)
                        : "";

                      return (
                        <div
                          key={key}
                          className="rounded-2xl border border-line bg-white px-4 py-4 shadow-soft"
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isTransferred || isImporting}
                              onChange={(event) => {
                                setSelectedActionKeys((current) =>
                                  event.target.checked
                                    ? [...current, key]
                                    : current.filter((value) => value !== key),
                                );
                              }}
                              className="mt-1 h-4 w-4 rounded border-line text-brand"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="text-[13px] font-semibold text-ink">{item.title}</p>
                                <span
                                  className={`rounded-full px-2 py-1 text-[10px] font-semibold ${priorityMeta.className}`}
                                >
                                  {priorityMeta.label}
                                </span>
                                {isTransferred ? (
                                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                                    Tasks 등록 완료
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-3">
                                <label className="text-[11px] font-semibold text-muted">
                                  담당자
                                  <input
                                    type="text"
                                    value={item.assigneeName}
                                    disabled={isTransferred}
                                    onChange={(event) =>
                                      handleActionItemFieldChange(
                                        index,
                                        "assigneeName",
                                        event.target.value,
                                      )
                                    }
                                    placeholder="담당자 이름"
                                    className="mt-1 w-full rounded-2xl border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none transition focus:border-brand disabled:bg-canvas"
                                  />
                                </label>

                                <div className="grid grid-cols-2 gap-3">
                                  <label className="text-[11px] font-semibold text-muted">
                                    우선순위
                                    <select
                                      value={item.priority ?? "medium"}
                                      disabled={isTransferred}
                                      onChange={(event) =>
                                        handleActionItemFieldChange(
                                          index,
                                          "priority",
                                          event.target.value,
                                        )
                                      }
                                      className="mt-1 w-full rounded-2xl border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none transition focus:border-brand disabled:bg-canvas"
                                    >
                                      <option value="high">높음</option>
                                      <option value="medium">보통</option>
                                      <option value="low">낮음</option>
                                    </select>
                                  </label>

                                  <label className="text-[11px] font-semibold text-muted">
                                    마감일
                                    <input
                                      type="date"
                                      value={dueDateValue}
                                      disabled={isTransferred}
                                      onChange={(event) =>
                                        handleActionItemFieldChange(
                                          index,
                                          "dueAt",
                                          event.target.value,
                                        )
                                      }
                                      className="mt-1 w-full rounded-2xl border border-line bg-white px-3 py-2 text-[13px] text-ink outline-none transition focus:border-brand disabled:bg-canvas"
                                    />
                                  </label>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl bg-canvas px-4 py-3 text-[13px] leading-6 text-muted">
                      추천된 Action Item이 없습니다.
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={selectedActionItems.length === 0 || isImporting}
                  onClick={() => {
                    void handleImportTasks();
                  }}
                  className="mt-4 w-full rounded-2xl border border-line bg-white px-4 py-4 text-sm font-semibold text-ink shadow-soft disabled:opacity-60"
                >
                  {isImporting ? "Tasks 전송 중..." : "선택한 항목을 Tasks로 등록"}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
