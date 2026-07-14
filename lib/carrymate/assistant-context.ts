import type {
  ConfirmedMeeting,
  FileItem,
  MeetingActionItem,
  Project,
  Task,
  TeamAvailabilityEntry,
  TeamMember,
} from "@/types/carrymate";

export type TeamAssistantSuggestedActionType =
  | "open_tasks"
  | "open_schedule"
  | "open_meeting"
  | "open_files"
  | "none";

export type TeamAssistantSuggestedAction = {
  type: TeamAssistantSuggestedActionType;
  targetId: string | null;
  label: string;
};

export type TeamAssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

export type TeamAssistantContext = {
  project: {
    id: string;
    name: string;
    courseName: string;
    description: string;
    deadlineLabel: string;
    endDate: string | null;
  };
  members: Array<{
    id: string;
    name: string;
    role: string;
    isLeader: boolean;
    status: "active" | "former";
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    status: Task["status"];
    priority: Task["priority"];
    assigneeId: string | null;
    assigneeName: string | null;
    dueAt: string | null;
    dueLabel: string;
    overdue: boolean;
  }>;
  meetings: Array<{
    id: string;
    title: string;
    startsAt: string | null;
    endsAt: string | null;
    status: ConfirmedMeeting["status"];
    agenda: string | null;
    aiSummary: string | null;
    aiDecisions: string[];
    aiUnresolvedItems: string[];
    aiActionItems: MeetingActionItem[];
  }>;
  meetingNotes: Array<{
    id: string;
    meetingId: string | null;
    title: string;
    aiSummary: string | null;
    aiDecisions: string[];
    aiUnresolvedItems: string[];
    aiActionItems: MeetingActionItem[];
  }>;
  availabilityRecommendations: Array<{
    label: string;
    availableMemberCount: number;
    memberNames: string[];
  }>;
  files: Array<{
    id: string;
    name: string;
    category: FileItem["category"];
    kind: "file" | "link";
    uploadedBy: string;
    uploadedAt: string;
  }>;
};

type BuildTeamAssistantContextInput = {
  project: Project;
  members: TeamMember[];
  tasks: Task[];
  meetings: ConfirmedMeeting[];
  teamAvailability: TeamAvailabilityEntry[];
  files: FileItem[];
};

type DemoAssistantResponse = {
  answer: string;
  suggestedActions: TeamAssistantSuggestedAction[];
};

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function trimText(value: string | null | undefined, maxLength: number) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isOverdueTask(task: Task) {
  if (task.status === "done" || !task.dueAt) {
    return false;
  }

  const dueDate = new Date(task.dueAt);
  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfDueDate = new Date(
    dueDate.getFullYear(),
    dueDate.getMonth(),
    dueDate.getDate(),
  );

  return startOfDueDate.getTime() < startOfToday.getTime();
}

function formatAvailabilityLabel(day: number, time: string) {
  const dayLabel = DAY_LABELS[day] ?? `${day}일`;
  return `${dayLabel} ${time}`;
}

function normalizeMeetingActionItems(items: MeetingActionItem[] | undefined) {
  return (items ?? []).slice(0, 5).map((item) => ({
    title: trimText(item.title, 80),
    assigneeName: trimText(item.assigneeName, 40),
    priority: item.priority,
    dueAt: item.dueAt ?? null,
    dueDateOffsetDays: item.dueDateOffsetDays,
    transferred: item.transferred === true,
    taskId: item.taskId ?? null,
  }));
}

function buildSuggestedAction(type: TeamAssistantSuggestedActionType, label: string, targetId: string | null = null) {
  return {
    type,
    label,
    targetId,
  };
}

function getTaskSuggestionActions(context: TeamAssistantContext) {
  const overdueTask = context.tasks.find((task) => task.overdue);
  if (overdueTask) {
    return [buildSuggestedAction("open_tasks", "업무 탭 보기")];
  }

  const unassignedTask = context.tasks.find((task) => !task.assigneeId);
  if (unassignedTask) {
    return [buildSuggestedAction("open_tasks", "업무 탭 보기")];
  }

  return [buildSuggestedAction("open_tasks", "업무 탭 보기")];
}

export function buildTeamAssistantContext(input: BuildTeamAssistantContextInput): TeamAssistantContext {
  const memberNameById = new Map(input.members.map((member) => [member.id, member.name]));

  const sortedTasks = input.tasks.slice(0, 30).map((task) => ({
    id: task.id,
    title: trimText(task.title, 100),
    description: task.description ? trimText(task.description, 140) : null,
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId ?? null,
    assigneeName: task.assigneeId ? memberNameById.get(task.assigneeId) ?? null : null,
    dueAt: task.dueAt ?? null,
    dueLabel: trimText(task.dueLabel, 40),
    overdue: isOverdueTask(task),
  }));

  const sortedMeetings = input.meetings.slice(0, 10).map((meeting) => ({
    id: meeting.id,
    title: trimText(meeting.title, 100),
    startsAt: meeting.startsAt ?? null,
    endsAt: meeting.endsAt ?? null,
    status: meeting.status,
    agenda: meeting.agenda ? trimText(meeting.agenda, 140) : null,
    aiSummary: meeting.aiSummary ? trimText(meeting.aiSummary, 220) : null,
    aiDecisions: (meeting.aiDecisions ?? []).slice(0, 5).map((item) => trimText(item, 80)).filter(Boolean),
    aiUnresolvedItems: (meeting.aiUnresolvedItems ?? [])
      .slice(0, 5)
      .map((item) => trimText(item, 80))
      .filter(Boolean),
    aiActionItems: normalizeMeetingActionItems(meeting.aiActionItems) as MeetingActionItem[],
  }));

  const meetingNotes = input.meetings
    .filter(
      (meeting) =>
        Boolean(meeting.aiSummary) ||
        (meeting.aiDecisions?.length ?? 0) > 0 ||
        (meeting.aiUnresolvedItems?.length ?? 0) > 0 ||
        (meeting.aiActionItems?.length ?? 0) > 0,
    )
    .slice(0, 5)
    .map((meeting) => ({
      id: meeting.noteId ?? meeting.id,
      meetingId: meeting.id,
      title: trimText(meeting.title, 100),
      aiSummary: meeting.aiSummary ? trimText(meeting.aiSummary, 220) : null,
      aiDecisions: (meeting.aiDecisions ?? []).slice(0, 5).map((item) => trimText(item, 80)).filter(Boolean),
      aiUnresolvedItems: (meeting.aiUnresolvedItems ?? [])
        .slice(0, 5)
        .map((item) => trimText(item, 80))
        .filter(Boolean),
      aiActionItems: normalizeMeetingActionItems(meeting.aiActionItems) as MeetingActionItem[],
    }));

  const availabilityMap = new Map<
    string,
    {
      memberNames: Set<string>;
      count: number;
      label: string;
    }
  >();

  input.teamAvailability.forEach((entry) => {
    const key = `${entry.day}|${entry.time}`;
    const current = availabilityMap.get(key);
    if (current) {
      current.memberNames.add(entry.memberName);
      current.count += 1;
      return;
    }

    availabilityMap.set(key, {
      label: formatAvailabilityLabel(entry.day, entry.time),
      count: 1,
      memberNames: new Set([entry.memberName]),
    });
  });

  const availabilityRecommendations = Array.from(availabilityMap.values())
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.label.localeCompare(right.label, "ko");
    })
    .slice(0, 5)
    .map((item) => ({
      label: item.label,
      availableMemberCount: item.count,
      memberNames: Array.from(item.memberNames).slice(0, 5),
    }));

  const files = input.files.slice(0, 20).map((file) => ({
    id: file.id,
    name: trimText(file.name, 100),
    category: file.category,
    kind: (file.resourceType === "link" || Boolean(file.resourceUrl?.startsWith("http")) ? "link" : "file") as
      | "file"
      | "link",
    uploadedBy: trimText(file.uploadedBy, 40),
    uploadedAt: trimText(file.uploadedAt, 40),
  }));

  return {
    project: {
      id: input.project.id,
      name: trimText(input.project.name, 120),
      courseName: trimText(input.project.courseName, 120),
      description: trimText(input.project.description ?? "", 220),
      deadlineLabel: trimText(input.project.deadlineLabel, 60),
      endDate: input.project.endDate ?? null,
    },
    members: input.members.slice(0, 30).map((member) => ({
      id: member.id,
      name: trimText(member.name, 60),
      role: trimText(member.role, 60),
      isLeader: Boolean(member.isLeader),
      status: member.status,
    })),
    tasks: sortedTasks,
    meetings: sortedMeetings,
    meetingNotes,
    availabilityRecommendations,
    files,
  };
}

function listTaskHighlights(context: TeamAssistantContext) {
  const overdueTasks = context.tasks.filter((task) => task.overdue).slice(0, 5);
  if (overdueTasks.length > 0) {
    return overdueTasks
      .map((task) => `- ${task.title}${task.assigneeName ? ` (${task.assigneeName})` : ""}`)
      .join("\n");
  }

  const unassignedTasks = context.tasks.filter((task) => !task.assigneeId).slice(0, 5);
  if (unassignedTasks.length > 0) {
    return unassignedTasks
      .map((task) => `- ${task.title}`)
      .join("\n");
  }

  return context.tasks
    .slice(0, 5)
    .map((task) => `- ${task.title}${task.assigneeName ? ` (${task.assigneeName})` : ""}`)
    .join("\n");
}

function getLatestMeetingNote(context: TeamAssistantContext) {
  return context.meetingNotes[0] ?? context.meetings[0] ?? null;
}

function pickTopFiles(context: TeamAssistantContext) {
  const referenceFiles = context.files.filter((file) => file.category === "reference");
  if (referenceFiles.length > 0) {
    return referenceFiles.slice(0, 5);
  }

  return context.files.slice(0, 5);
}

function buildReadOnlyReminder() {
  return "이 챗봇은 읽기 전용입니다. 변경이 필요하면 관련 탭을 열어 직접 확인해 주세요.";
}

export function buildDemoAssistantResponse(
  question: string,
  context: TeamAssistantContext,
): DemoAssistantResponse {
  const normalizedQuestion = question.trim();
  const lowerQuestion = normalizedQuestion.replace(/\s+/g, "").toLowerCase();

  if (!normalizedQuestion) {
    return {
      answer: "질문을 입력해 주세요.",
      suggestedActions: [],
    };
  }

  if (/[삭제제거수정변경추가생성]/.test(normalizedQuestion)) {
    return {
      answer: `${buildReadOnlyReminder()}\n\n현재는 화면 이동만 도와드릴 수 있어요.`,
      suggestedActions: [buildSuggestedAction("open_tasks", "업무 탭 보기")],
    };
  }

  if (lowerQuestion.includes("연체") || lowerQuestion.includes("늦은업무")) {
    const overdueTasks = context.tasks.filter((task) => task.overdue).slice(0, 5);
    if (overdueTasks.length === 0) {
      return {
        answer: "현재 저장된 데이터에서는 연체된 업무를 확인할 수 없습니다.",
        suggestedActions: getTaskSuggestionActions(context),
      };
    }

    return {
      answer: [
        "연체된 업무입니다.",
        ...overdueTasks.map((task) => `- ${task.title}${task.assigneeName ? ` / ${task.assigneeName}` : ""}`),
      ].join("\n"),
      suggestedActions: getTaskSuggestionActions(context),
    };
  }

  if (lowerQuestion.includes("담당자없") || (lowerQuestion.includes("담당자") && lowerQuestion.includes("없"))) {
    const unassignedTasks = context.tasks.filter((task) => !task.assigneeId).slice(0, 5);
    if (unassignedTasks.length === 0) {
      return {
        answer: "현재 저장된 데이터에서는 담당자가 없는 업무를 확인할 수 없습니다.",
        suggestedActions: [buildSuggestedAction("open_tasks", "업무 탭 보기")],
      };
    }

    return {
      answer: [
        "담당자가 없는 업무입니다.",
        ...unassignedTasks.map((task) => `- ${task.title}`),
      ].join("\n"),
      suggestedActions: [buildSuggestedAction("open_tasks", "업무 탭 보기")],
    };
  }

  if (lowerQuestion.includes("최근회의") || lowerQuestion.includes("회의요약") || lowerQuestion.includes("결정된내용")) {
    const latestMeeting = getLatestMeetingNote(context);
    if (!latestMeeting) {
      return {
        answer: "현재 저장된 데이터에서는 최근 회의 내용을 확인할 수 없습니다.",
        suggestedActions: [buildSuggestedAction("open_schedule", "일정 탭 보기")],
      };
    }

    const decisions = latestMeeting.aiDecisions?.length ? latestMeeting.aiDecisions : [];
    const unresolved = latestMeeting.aiUnresolvedItems?.length ? latestMeeting.aiUnresolvedItems : [];

    return {
      answer: [
        `최근 회의: ${latestMeeting.title}`,
        latestMeeting.aiSummary ? `요약: ${latestMeeting.aiSummary}` : null,
        decisions.length > 0 ? `결정사항:\n${decisions.map((item) => `- ${item}`).join("\n")}` : null,
        unresolved.length > 0 ? `미결정:\n${unresolved.map((item) => `- ${item}`).join("\n")}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      suggestedActions: [buildSuggestedAction("open_meeting", "최근 회의 열기", latestMeeting.meetingId)],
    };
  }

  if (lowerQuestion.includes("미결정") || lowerQuestion.includes("결정안")) {
    const latestMeeting = getLatestMeetingNote(context);
    const unresolved = latestMeeting?.aiUnresolvedItems ?? [];
    if (unresolved.length === 0) {
      return {
        answer: "현재 저장된 데이터에서는 미결정 사항을 확인할 수 없습니다.",
        suggestedActions: [buildSuggestedAction("open_schedule", "일정 탭 보기")],
      };
    }

    return {
      answer: [
        "미결정 사항입니다.",
        ...unresolved.slice(0, 5).map((item) => `- ${item}`),
      ].join("\n"),
      suggestedActions: [buildSuggestedAction("open_schedule", "일정 탭 보기")],
    };
  }

  if (lowerQuestion.includes("다음") && lowerQuestion.includes("해야")) {
    const overdueTasks = context.tasks.filter((task) => task.overdue).slice(0, 3);
    const unassignedTasks = context.tasks.filter((task) => !task.assigneeId).slice(0, 3);
    const nextTasks = overdueTasks.length > 0 ? overdueTasks : context.tasks.slice(0, 3);

    return {
      answer: [
        "지금은 아래 순서로 보면 좋습니다.",
        nextTasks.length > 0 ? `- 우선 확인할 업무:\n${nextTasks.map((task) => `  · ${task.title}`).join("\n")}` : null,
        unassignedTasks.length > 0
          ? `- 담당자 없는 업무:\n${unassignedTasks.map((task) => `  · ${task.title}`).join("\n")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      suggestedActions: [buildSuggestedAction("open_tasks", "업무 탭 보기")],
    };
  }

  if (lowerQuestion.includes("참고자료") || lowerQuestion.includes("자료") || lowerQuestion.includes("파일")) {
    const files = pickTopFiles(context);
    if (files.length === 0) {
      return {
        answer: "현재 저장된 데이터에서는 참고자료를 확인할 수 없습니다.",
        suggestedActions: [buildSuggestedAction("open_files", "파일 탭 보기")],
      };
    }

    return {
      answer: [
        "참고자료입니다.",
        ...files.map((file) => `- ${file.name}${file.kind === "link" ? " (링크)" : ""}`),
      ].join("\n"),
      suggestedActions: [buildSuggestedAction("open_files", "파일 탭 보기")],
    };
  }

  if (lowerQuestion.includes("오늘") && lowerQuestion.includes("할일")) {
    const todayTasks = context.tasks
      .filter((task) => task.dueLabel.includes("오늘") || task.overdue)
      .slice(0, 5);

    if (todayTasks.length === 0) {
      return {
        answer: "오늘 기준으로 바로 확인할 업무는 없습니다.",
        suggestedActions: [buildSuggestedAction("open_tasks", "업무 탭 보기")],
      };
    }

    return {
      answer: [
        "오늘 확인할 업무입니다.",
        ...todayTasks.map((task) => `- ${task.title}${task.assigneeName ? ` / ${task.assigneeName}` : ""}`),
      ].join("\n"),
      suggestedActions: [buildSuggestedAction("open_tasks", "업무 탭 보기")],
    };
  }

  if (context.tasks.length === 0 && context.meetings.length === 0 && context.files.length === 0) {
    return {
      answer: "현재 저장된 데이터가 거의 없습니다. 자료가 쌓이면 더 구체적으로 도와드릴 수 있어요.",
      suggestedActions: [],
    };
  }

  const availabilityText = context.availabilityRecommendations.length
    ? `추천 회의 시간 예시: ${context.availabilityRecommendations[0]?.label} (${context.availabilityRecommendations[0]?.availableMemberCount}명)`
    : null;

  return {
    answer: [
      `${context.project.name} 기준으로 확인한 요약입니다.`,
      `업무 ${context.tasks.length}개, 회의 ${context.meetings.length}개, 자료 ${context.files.length}개가 등록되어 있습니다.`,
      availabilityText,
      context.tasks.length > 0 ? `업무 미리보기:\n${listTaskHighlights(context)}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
    suggestedActions: [
      buildSuggestedAction("open_tasks", "업무 탭 보기"),
      buildSuggestedAction("open_schedule", "일정 탭 보기"),
      buildSuggestedAction("open_files", "파일 탭 보기"),
    ],
  };
}
