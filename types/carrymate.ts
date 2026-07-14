export type TabId = "home" | "tasks" | "schedule" | "files";

export type HealthStatus = "safe" | "warning" | "risk";
export type TaskStatus = "todo" | "inProgress" | "done";
export type TaskPriority = "high" | "medium" | "low";
export type FileCategory =
  | "minutes"
  | "presentation"
  | "reference"
  | "references"
  | "materials"
  | "links"
  | "other";
export type MeetingStatus = "scheduled" | "inProgress" | "ended";

export type Project = {
  id: string;
  name: string;
  courseName: string;
  deadlineLabel: string;
  inviteCode?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
};

export type TeamMember = {
  id: string;
  name: string;
  role: string;
  skillTag: string;
  isLeader?: boolean;
  availability: string[];
  status: "active" | "former";
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  assigneeId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueLabel: string;
  dueAt?: string | null;
  aiSuggestedRole?: string;
  completedAt?: string | null;
};

export type ScheduleSlot = {
  id: string;
  label: string;
  dateLabel: string;
  timeRange: string;
  memberIds: string[];
  recommended: boolean;
};

export type TeamAvailabilityEntry = {
  memberId: string;
  memberName: string;
  day: number;
  time: string;
};

export type ConfirmedMeeting = {
  id: string;
  title: string;
  dateLabel: string;
  timeRange: string;
  attendeeCount: number;
  status: MeetingStatus;
  agenda?: string | null;
  createdByMemberId?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  teamId?: string;
  isEnded?: boolean;
  aiSummary?: string;
  aiDecisions?: string[];
  aiUnresolvedItems?: string[];
  aiActionItems?: MeetingActionItem[];
  noteId?: string;
  pinnedMessages?: MeetingMessage[];
};

export type MeetingActionItem = {
  title: string;
  assigneeName: string;
  priority?: TaskPriority;
  dueAt?: string | null;
  dueDateOffsetDays: number;
  transferred?: boolean;
  taskId?: string | null;
};

export type MeetingMessage = {
  id: string;
  meetingId: string;
  memberId: string | null;
  senderName: string;
  message: string;
  createdAt: string;
};

export type MeetingNote = {
  id: string;
  teamId: string;
  meetingId: string | null;
  title: string;
  content: string;
  agenda: string | null;
  pinnedMessages: MeetingMessage[];
  aiSummary: string | null;
  aiDecisions: string[];
  aiUnresolvedItems: string[];
  aiActionItems: MeetingActionItem[];
  createdAt: string;
};

export type FileItem = {
  id: string;
  name: string;
  category: FileCategory;
  uploadedBy: string;
  uploadedByMemberId?: string | null;
  uploadedAt: string;
  statusLabel: string;
  isFinal: boolean;
  source?: "demo" | "storage";
  sharedFileId?: string | null;
  latestVersionId?: string | null;
  fileVersionId?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  originalFileName?: string | null;
  resourceType?: "file" | "link";
  resourceUrl?: string | null;
  note?: string | null;
};
