import { useMemo, useState } from "react";
import { ConfirmedMeeting, Task } from "@/types/carrymate123";

type Summary = {
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
  healthStatus: "safe" | "warning" | "risk";
  briefing: string;
};

const analysisPresets = [
  {
    status: "safe" as const,
    summary:
      "현재 프로젝트 흐름이 안정적이에요. 오늘 예정된 업무를 순서대로 진행해 주세요.",
  },
  {
    status: "warning" as const,
    summary:
      "오늘 마감 업무가 남아 있어요. 우선순위가 높은 업무부터 확인해 주세요.",
  },
  {
    status: "risk" as const,
    summary:
      "담당자가 정해지지 않았거나 진행이 지연된 업무가 있어 빠른 확인이 필요해요.",
  },
];

const PRIORITY_LABELS: Record<Task["priority"], string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

function getTaskComparableDate(task: Task) {
  if (task.dueAt) {
    const dueDate = new Date(task.dueAt);
    if (!Number.isNaN(dueDate.getTime())) {
      return dueDate;
    }
  }

  if (task.dueLabel === "오늘") {
    const date = new Date();
    date.setHours(18, 0, 0, 0);
    return date;
  }

  if (task.dueLabel === "내일") {
    const date = new Date();
    date.setHours(18, 0, 0, 0);
    date.setDate(date.getDate() + 1);
    return date;
  }

  return null;
}

function getTaskSortRank(task: Task) {
  if (task.status === "done") {
    return 4;
  }

  const dueDate = getTaskComparableDate(task);
  if (!dueDate) {
    return 5;
  }

  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfDueDate = new Date(
    dueDate.getFullYear(),
    dueDate.getMonth(),
    dueDate.getDate(),
  );

  const diffDays = Math.round(
    (startOfDueDate.getTime() - startOfToday.getTime()) / 86400000,
  );

  if (diffDays < 0) {
    return 0;
  }

  if (diffDays === 0) {
    return 1;
  }

  if (diffDays <= 2) {
    return 2;
  }

  return 3;
}

function compareTasksByDeadline(a: Task, b: Task) {
  const rankDiff = getTaskSortRank(a) - getTaskSortRank(b);
  if (rankDiff !== 0) {
    return rankDiff;
  }

  const aDue = getTaskComparableDate(a)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bDue = getTaskComparableDate(b)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aDue !== bDue) {
    return aDue - bDue;
  }

  const priorityOrder: Record<Task["priority"], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return a.title.localeCompare(b.title, "ko-KR");
}

function formatTaskDeadline(task: Task) {
  const dueDate = getTaskComparableDate(task);
  if (!dueDate) {
    if (task.dueLabel && task.dueLabel !== "마감일 없음") {
      return `${task.dueLabel} · 시간 미설정`;
    }

    return "마감일 없음 · 시간 미설정";
  }

  const dateLabel = `${dueDate.getFullYear()}.${String(
    dueDate.getMonth() + 1,
  ).padStart(2, "0")}.${String(dueDate.getDate()).padStart(2, "0")}`;
  const timeLabel = `${String(dueDate.getHours()).padStart(2, "0")}:${String(
    dueDate.getMinutes(),
  ).padStart(2, "0")}`;

  return `${dateLabel} · ${timeLabel}`;
}

function getTaskStatusLabel(task: Task) {
  if (task.status === "done") {
    return "완료";
  }

  const dueDate = getTaskComparableDate(task);
  if (!dueDate) {
    return "마감일 없음";
  }

  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const startOfDueDate = new Date(
    dueDate.getFullYear(),
    dueDate.getMonth(),
    dueDate.getDate(),
  );
  const diffDays = Math.round(
    (startOfDueDate.getTime() - startOfToday.getTime()) / 86400000,
  );

  if (diffDays < 0) {
    return "연체";
  }

  if (diffDays === 0) {
    return "오늘 마감";
  }

  if (diffDays <= 2) {
    return "마감 임박";
  }

  return "미래 마감";
}

export function HomeTab({
  summary,
  tasks,
  todayMeetings,
  upcomingMeetings,
  onJumpToTasks,
  onJumpToSchedule,
}: {
  summary: Summary;
  tasks: Task[];
  todayMeetings: ConfirmedMeeting[];
  upcomingMeetings: ConfirmedMeeting[];
  onJumpToTasks: () => void;
  onJumpToSchedule: () => void;
}) {
  const sortedTasks = useMemo(
    () => [...tasks].sort(compareTasksByDeadline),
    [tasks],
  );
  const visibleTasks = sortedTasks.slice(0, 3);
  const urgentTask =
    summary.urgentTask ?? sortedTasks.find((task) => task.status !== "done");
  const priorityLabel = urgentTask
    ? PRIORITY_LABELS[urgentTask.priority]
    : "확인 필요";

  const [analysisState, setAnalysisState] = useState(() =>
    summary.healthStatus === "risk"
      ? analysisPresets[2]
      : summary.healthStatus === "warning"
        ? analysisPresets[1]
        : analysisPresets[0],
  );

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefreshAnalysis = () => {
    setIsRefreshing(true);

    window.setTimeout(() => {
      const randomIndex = Math.floor(Math.random() * analysisPresets.length);
      setAnalysisState(analysisPresets[randomIndex]);
      setIsRefreshing(false);
    }, 700);
  };

  return (
    <div className="space-y-4 pb-4">
      {/* 과목별 과제 진행률 */}
      <section className="rounded-[28px] border border-[#eeeaf8] bg-white px-5 py-6 shadow-[0_10px_30px_rgba(80,63,155,0.08)] sm:px-6 lg:px-7">
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[auto,minmax(0,1fr)] lg:items-center lg:gap-6">
          <div className="flex justify-center lg:justify-start">
            <ProgressCircle progress={summary.progress} />
          </div>

          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-extrabold text-[#282438] sm:text-xl lg:text-2xl">
                과목별 과제 진행률
              </h2>

              <button
                type="button"
                onClick={onJumpToTasks}
                className="rounded-full bg-[#efedff] px-3 py-1 text-[11px] font-semibold text-[#6259e8] sm:text-xs"
              >
                업무 보기
              </button>
            </div>

            <p className="break-keep text-[13px] leading-6 text-[#77718a] sm:text-sm lg:text-base">
              완료 {summary.doneCount}/{summary.totalCount}개 · 진행률{" "}
              {summary.progress}% · 진행 중 {summary.inProgressCount}개 · 연체{" "}
              {summary.overdueCount}개
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[20px] bg-[#faf9ff] px-4 py-4">
                <p className="text-[11px] font-semibold text-[#9a94a8] sm:text-xs">
                  완료 업무
                </p>
                <p className="mt-2 text-[15px] font-bold text-[#2f2a3f] sm:text-base lg:text-lg">
                  {summary.doneCount}/{summary.totalCount}개
                </p>
              </div>

              <div className="rounded-[20px] bg-[#faf9ff] px-4 py-4">
                <p className="text-[11px] font-semibold text-[#9a94a8] sm:text-xs">
                  진행률
                </p>
                <p className="mt-2 text-[15px] font-bold text-[#2f2a3f] sm:text-base lg:text-lg">
                  {summary.progress}%
                </p>
              </div>

              <div className="rounded-[20px] bg-[#faf9ff] px-4 py-4">
                <p className="text-[11px] font-semibold text-[#9a94a8] sm:text-xs">
                  우선순위
                </p>
                <p className="mt-2 text-[15px] font-bold text-[#2f2a3f] sm:text-base lg:text-lg">
                  {priorityLabel}
                </p>
              </div>
            </div>

            <div className="rounded-[22px] border border-[#eeeaf8] bg-[#faf9ff] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-[#6259e8]">
                  다음 우선순위
                </span>

                {urgentTask ? (
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-[#8a849b]">
                    {PRIORITY_LABELS[urgentTask.priority]}
                  </span>
                ) : null}
              </div>

              <p className="mt-3 break-keep text-[14px] font-bold leading-6 text-[#2f2a3f] sm:text-base lg:text-[17px]">
                {urgentTask?.title ?? "오늘의 핵심 업무를 확인해 주세요"}
              </p>

              <p className="mt-2 break-keep text-[12px] leading-5 text-[#77718a] sm:text-sm lg:text-base">
                {urgentTask
                  ? `${formatTaskDeadline(urgentTask)} · ${getTaskStatusLabel(urgentTask)}`
                  : "모든 긴급 업무를 완료했어요. 다음 업무를 확인해 보세요."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* AI 브리핑 */}
      <section className="rounded-[22px] border-l-4 border-[#665cf0] bg-white px-4 py-4 shadow-[0_8px_24px_rgba(67,55,120,0.08)]">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f0eeff] text-lg">
            ✦
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-bold text-[#4f46d8] sm:text-base lg:text-lg">
                AI 브리핑
              </h3>

              <button
                type="button"
                onClick={handleRefreshAnalysis}
                disabled={isRefreshing}
                className="text-[11px] font-semibold text-[#8b86a0] disabled:opacity-50"
              >
                {isRefreshing ? "분석 중..." : "새로 분석"}
              </button>
            </div>

            <p className="mt-2 break-keep text-[13px] leading-6 text-[#625d70] sm:text-sm lg:text-base">
              {analysisState.summary}
            </p>
          </div>
        </div>
      </section>

      {/* 위험 알림 */}
      {summary.unassignedCount > 0 && (
        <AlertCard
          icon="△"
          title="AI 리스크 분석"
          description={`담당자가 지정되지 않은 업무가 ${summary.unassignedCount}개 있습니다. 업무 탭에서 자동 재분배해 주세요.`}
          tone="pink"
          onClick={onJumpToTasks}
        />
      )}

      {summary.todayTaskCount >= 2 && (
        <AlertCard
          icon="♧"
          title="중요 마감기한"
          description={`오늘 처리해야 할 업무가 ${summary.todayTaskCount}개 남았습니다. 중요한 업무부터 진행해 주세요.`}
          tone="red"
          onClick={onJumpToTasks}
        />
      )}

      {/* 마감이 가까운 과제 */}
      <section>
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <h3 className="text-[16px] font-bold text-[#252236] sm:text-lg lg:text-xl">
              마감이 가까운 과제
            </h3>
            <p className="mt-1 text-[11px] text-[#8f89a0] sm:text-xs lg:text-sm">
              마감일이 가까운 순서로 정렬했어요.
            </p>
          </div>

          <button
            type="button"
            onClick={onJumpToTasks}
            className="text-[12px] font-semibold text-[#6259e8]"
          >
            모두 보기
          </button>
        </div>

        <div className="space-y-2.5">
          {visibleTasks.length === 0 ? (
            <EmptyState text="등록된 과제가 없어요." />
          ) : (
            visibleTasks.map((task) => {
              const statusLabel = getTaskStatusLabel(task);

              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={onJumpToTasks}
                  className="flex w-full flex-col gap-3 rounded-[20px] border border-[#eeeaf7] bg-white px-4 py-4 text-left shadow-[0_7px_20px_rgba(64,52,115,0.07)] sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        task.status === "inProgress"
                          ? "bg-[#eeeaff] text-[#6259e8]"
                          : task.status === "done"
                            ? "bg-[#f2f0f7] text-[#8a849b]"
                            : "bg-[#f6f4fb] text-[#aaa5b8]"
                      }`}
                    >
                      {task.status === "inProgress"
                        ? "◔"
                        : task.status === "done"
                          ? "✓"
                          : "•"}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 break-words text-[13px] font-bold text-[#343044] sm:text-sm lg:text-base">
                        {task.title}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                            statusLabel === "연체"
                              ? "bg-[#fff0f2] text-[#d83352]"
                              : statusLabel === "오늘 마감"
                                ? "bg-[#fff4e6] text-[#d9821b]"
                                : statusLabel === "마감 임박"
                                  ? "bg-[#f0eeff] text-[#6259e8]"
                                  : statusLabel === "완료"
                                    ? "bg-[#f2f0f7] text-[#7e7892]"
                                    : "bg-[#f6f4fb] text-[#8b86a0]"
                          }`}
                        >
                          {statusLabel}
                        </span>

                        <span className="rounded-full bg-[#faf9ff] px-2.5 py-1 text-[11px] font-semibold text-[#8b86a0]">
                          우선순위 {PRIORITY_LABELS[task.priority]}
                        </span>
                      </div>

                      <p className="mt-2 break-keep text-[11px] text-[#9993a7] sm:text-xs">
                        {formatTaskDeadline(task)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:ml-auto sm:min-w-[160px] sm:flex-col sm:items-end sm:justify-center">
                    <p className="text-[11px] text-[#9993a7] sm:text-xs">
                      {task.status === "inProgress"
                        ? "진행 중"
                        : task.status === "done"
                          ? "완료"
                          : "대기"}
                    </p>

                    <span className="text-lg text-[#aba5bb]">⋮</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* 오늘 일정 */}
      {todayMeetings.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="text-[16px] font-bold text-[#252236] sm:text-lg lg:text-xl">
              오늘의 일정
            </h3>

            <button
              type="button"
              onClick={onJumpToSchedule}
              className="text-[12px] font-semibold text-[#6259e8]"
            >
              일정 보기
            </button>
          </div>

          <div className="space-y-2.5">
            {todayMeetings.slice(0, 2).map((meeting) => (
              <MeetingRow key={meeting.id} meeting={meeting} />
            ))}
          </div>
        </section>
      )}

      {/* 진행 중인 프로젝트 */}
      <section>
        <h3 className="mb-3 px-1 text-[16px] font-bold text-[#252236] sm:text-lg lg:text-xl">
          진행 중인 프로젝트
        </h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <QuickMenu
            icon="📊"
            title="프로젝트 진행 현황"
            description={`${summary.progress}% · 완료 ${summary.doneCount}/${summary.totalCount} · 진행 중 ${summary.inProgressCount} · 연체 ${summary.overdueCount}`}
            onClick={onJumpToTasks}
          />

          <QuickMenu
            icon="📅"
            title="팀 일정"
            description={`${todayMeetings.length + upcomingMeetings.length}개 일정`}
            onClick={onJumpToSchedule}
          />
        </div>
      </section>
    </div>
  );
}

function ProgressCircle({ progress }: { progress: number }) {
  const safeProgress = Math.max(0, Math.min(progress, 100));
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safeProgress / 100) * circumference;

  return (
    <div className="relative h-32 w-32">
      <svg
        viewBox="0 0 120 120"
        className="h-full w-full -rotate-90"
        aria-label={`프로젝트 진행률 ${safeProgress}%`}
      >
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="#efedf7"
          strokeWidth="9"
        />

        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="#5b52e8"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <strong className="text-[28px] font-extrabold text-[#5148df]">
          {safeProgress}%
        </strong>
        <span className="mt-0.5 text-[10px] font-semibold text-[#9892a8]">
          진행 상태
        </span>
      </div>
    </div>
  );
}

function AlertCard({
  icon,
  title,
  description,
  tone,
  onClick,
}: {
  icon: string;
  title: string;
  description: string;
  tone: "pink" | "red";
  onClick: () => void;
}) {
  const toneClass =
    tone === "pink"
      ? "border-l-[#f0549a] bg-[#fffafd] text-[#d93b83]"
      : "border-l-[#ef4d58] bg-[#fffafa] text-[#dc3845]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-[22px] border-l-4 px-4 py-4 text-left shadow-[0_8px_24px_rgba(67,55,120,0.07)] ${toneClass}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg">{icon}</span>

        <div>
          <h3 className="text-[13px] font-bold">{title}</h3>
          <p className="mt-2 text-[12px] leading-5 text-[#686272]">
            {description}
          </p>
        </div>
      </div>
    </button>
  );
}

function MeetingRow({ meeting }: { meeting: ConfirmedMeeting }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-[20px] border border-[#eeeaf7] bg-white px-4 py-4 text-left shadow-[0_7px_20px_rgba(64,52,115,0.07)]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f1efff] text-[#6259e8]">
        ◷
      </span>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 break-words text-[13px] font-bold text-[#343044] sm:text-sm lg:text-base">
          {meeting.title}
        </p>
        <p className="mt-1 whitespace-nowrap text-[11px] text-[#9993a7] sm:text-xs">
          {meeting.dateLabel} · {meeting.timeRange}
        </p>
      </div>

      <span className="text-[#aaa5b8]">›</span>
    </button>
  );
}

function QuickMenu({
  icon,
  title,
  description,
  onClick,
}: {
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-28 items-center gap-3 rounded-[22px] border border-[#eeeaf7] bg-white p-4 text-left shadow-[0_8px_24px_rgba(64,52,115,0.08)] transition active:scale-[0.98] sm:p-5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f1efff] text-[17px] font-bold text-[#6259e8]">
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-[#322e40] sm:text-sm lg:text-base">
          {title}
        </p>
        <p className="mt-1 break-keep text-[10px] text-[#9a94a8] sm:text-xs lg:text-sm">
          {description}
        </p>
      </div>
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-[#ddd8ea] bg-white px-4 py-7 text-center text-[12px] text-[#9690a5]">
      {text}
    </div>
  );
}
