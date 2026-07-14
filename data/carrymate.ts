import {
  ConfirmedMeeting,
  FileItem,
  Project,
  ScheduleSlot,
  Task,
  TeamMember,
} from "@/types/carrymate";

// TODO: Supabase 연동 시 `projects` 테이블 조회 결과로 대체 가능
export const initialProject: Project = {
  id: "project-hci",
  name: "캠퍼스 UX 발표 팀플",
  courseName: "인간컴퓨터상호작용",
  deadlineLabel: "7월 12일 발표",
};

// TODO: Supabase 연동 시 `team_members` 테이블 fetch 결과로 대체 가능
export const teamMembers: TeamMember[] = [
  {
    id: "member-1",
    name: "민지",
    role: "팀장 / 발표 정리",
    skillTag: "정리형",
    availability: ["수 18:00", "목 14:00", "목 19:00"],
    status: "active",
  },
  {
    id: "member-2",
    name: "준호",
    role: "자료 조사",
    skillTag: "리서치형",
    availability: ["수 18:00", "목 19:00"],
    status: "active",
  },
  {
    id: "member-3",
    name: "서연",
    role: "디자인",
    skillTag: "비주얼형",
    availability: ["목 14:00", "목 19:00"],
    status: "active",
  },
  {
    id: "member-4",
    name: "도윤",
    role: "문서 작성",
    skillTag: "문서형",
    availability: ["수 18:00", "목 14:00"],
    status: "active",
  },
];

// TODO: Supabase 연동 시 `tasks` 테이블 fetch 결과로 대체 가능
export const initialTasks: Task[] = [
  {
    id: "task-1",
    title: "경쟁 서비스 조사 정리",
    assigneeId: "member-2",
    status: "todo",
    priority: "high",
    dueLabel: "오늘",
    aiSuggestedRole: "자료 조사 담당에게 적합",
  },
  {
    id: "task-2",
    title: "발표 흐름 와이어 정리",
    assigneeId: "member-1",
    status: "inProgress",
    priority: "high",
    dueLabel: "오늘",
    aiSuggestedRole: "팀장이 우선 확인하면 좋아요",
  },
  {
    id: "task-3",
    title: "메인 화면 시안 다듬기",
    assigneeId: "member-3",
    status: "inProgress",
    priority: "medium",
    dueLabel: "내일",
    aiSuggestedRole: "디자인 담당에게 적합",
  },
  {
    id: "task-4",
    title: "회의록 템플릿 정리",
    assigneeId: "member-4",
    status: "done",
    priority: "low",
    dueLabel: "완료",
  },
  {
    id: "task-5",
    title: "사용자 문제 정의 한 줄 요약",
    assigneeId: "member-1",
    status: "todo",
    priority: "medium",
    dueLabel: "오늘",
  },
  {
    id: "task-6",
    title: "발표 리허설 질문 예상",
    assigneeId: "member-4",
    status: "done",
    priority: "medium",
    dueLabel: "완료",
  },
];

// TODO: Supabase 연동 시 `schedule_slots` 테이블 fetch 결과로 대체 가능
export const initialScheduleSlots: ScheduleSlot[] = [
  {
    id: "slot-1",
    label: "가장 많이 겹치는 시간",
    dateLabel: "7월 9일 목요일",
    timeRange: "19:00 - 20:00",
    memberIds: ["member-1", "member-2", "member-3"],
    recommended: true,
  },
  {
    id: "slot-2",
    label: "발표 전 최종 점검",
    dateLabel: "7월 10일 금요일",
    timeRange: "14:00 - 14:40",
    memberIds: ["member-1", "member-3", "member-4"],
    recommended: true,
  },
  {
    id: "slot-3",
    label: "짧은 진행 체크",
    dateLabel: "오늘",
    timeRange: "18:00 - 18:20",
    memberIds: ["member-1", "member-2", "member-4"],
    recommended: false,
  },
];

// TODO: Supabase 연동 시 `confirmed_meetings` 테이블 fetch 결과로 대체 가능
export const initialConfirmedMeetings: ConfirmedMeeting[] = [
  {
    id: "meeting-1",
    title: "오늘 진행 상황 체크",
    dateLabel: "오늘",
    timeRange: "20:30 - 21:00",
    attendeeCount: 4,
    status: "inProgress",
    createdByMemberId: "member-1",
    isEnded: false,
  },
];

// TODO: Supabase 연동 시 `files` 테이블 fetch 결과로 대체 가능
export const initialFiles: FileItem[] = [
  {
    id: "file-1",
    name: "회의록_0706",
    category: "minutes",
    uploadedBy: "민지",
    uploadedByMemberId: "member-1",
    uploadedAt: "10분 전",
    statusLabel: "검토중",
    isFinal: false,
  },
  {
    id: "file-2",
    name: "발표자료_v3",
    category: "materials",
    uploadedBy: "서연",
    uploadedByMemberId: "member-3",
    uploadedAt: "30분 전",
    statusLabel: "초안",
    isFinal: false,
  },
  {
    id: "file-3",
    name: "최종_발표자료",
    category: "materials",
    uploadedBy: "민지",
    uploadedByMemberId: "member-1",
    uploadedAt: "1시간 전",
    statusLabel: "최종본",
    isFinal: true,
  },
  {
    id: "file-4",
    name: "참고링크_서비스조사",
    category: "links",
    uploadedBy: "준호",
    uploadedByMemberId: "member-2",
    uploadedAt: "1시간 전",
    statusLabel: "검토중",
    isFinal: false,
  },
  {
    id: "file-5",
    name: "과제요구사항_요약",
    category: "materials",
    uploadedBy: "도윤",
    uploadedByMemberId: "member-4",
    uploadedAt: "어제",
    statusLabel: "검토중",
    isFinal: false,
  },
];

export function getDemoWorkspace() {
  // TODO: Supabase 연동 시 이 함수는 여러 mock 배열을 조합하는 대신
  // 프로젝트 초기 조회용 repository/service 함수로 교체 가능
  return {
    project: { ...initialProject },
    members: teamMembers.map((member) => ({ ...member })),
    tasks: initialTasks.map((task) => ({ ...task })),
    scheduleSlots: initialScheduleSlots.map((slot) => ({ ...slot })),
    meetings: initialConfirmedMeetings.map((meeting) => ({ ...meeting })),
    files: initialFiles.map((file) => ({ ...file })),
  };
}
