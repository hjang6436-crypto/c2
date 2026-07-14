import Image from "next/image";
import { Task, TeamMember } from "@/types/carrymate";

const columns = [
  {
    id: "todo",
    label: "할 일",
    description: "아직 시작하지 않은 업무",
    accentClass: "border-l-[#6c63f1]",
    badgeClass: "bg-[#efedff] text-[#5b53dc]",
  },
  {
    id: "inProgress",
    label: "진행 중",
    description: "현재 작업하고 있는 업무",
    accentClass: "border-l-[#d6257d]",
    badgeClass: "bg-[#fff0f7] text-[#d6257d]",
  },
  {
    id: "done",
    label: "검토 및 완료",
    description: "완료했거나 확인이 필요한 업무",
    accentClass: "border-l-[#8d87aa]",
    badgeClass: "bg-[#f2f0f7] text-[#736d86]",
  },
] as const;

export function TaskTab({
  members,
  tasks,
  hasUnassignedTasks,
  onAddTask,
  onAdvanceTask,
  onRequestMemberExit,
  onAutoRedistribute,
}: {
  members: TeamMember[];
  tasks: Task[];
  hasUnassignedTasks: boolean;
  onAddTask: () => void;
  onAdvanceTask: (taskId: string) => void;
  onRequestMemberExit: (memberId: string) => void;
  onAutoRedistribute: () => void;
}) {
  const activeMembers = members.filter((member) => member.status === "active");
  const formerMembers = members.filter((member) => member.status === "former");

  const doneCount = tasks.filter((task) => task.status === "done").length;
  const progress =
    tasks.length === 0 ? 0 : Math.round((doneCount / tasks.length) * 100);

  return (
    <div className="space-y-4 pb-4">
      {/* 팀 기여도 */}
      <section className="rounded-[26px] border border-[#eeeaf8] bg-white p-5 shadow-[0_10px_30px_rgba(80,63,155,0.08)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[19px] font-extrabold text-[#282438] sm:text-[22px] lg:text-[26px] break-keep">
              팀 기여도
            </h2>
            <p className="mt-2 max-w-[240px] text-[12px] leading-5 text-[#8d879b] sm:text-sm break-keep">
              이번 주 프로젝트 달성도를 기준으로 팀 흐름을 분석했어요.
            </p>
          </div>

          <div className="flex -space-x-2">
            {activeMembers.slice(0, 3).map((member, index) => (
              <MemberAvatar
                key={member.id}
                name={member.name}
                index={index}
                avatarUrl={resolveMemberAvatarUrl(member)}
              />
            ))}

            {activeMembers.length > 3 ? (
              <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[#efedff] text-[10px] font-bold text-[#6259e8]">
                +{activeMembers.length - 3}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-[22px] bg-[#faf9ff] px-5 py-5">
          <div>
            <p className="text-[11px] font-semibold text-[#9b95aa]">
              팀 목표 달성률
            </p>
            <p className="mt-2 text-[13px] font-bold text-[#373244]">
              {doneCount}개 완료 / 전체 {tasks.length}개
            </p>
          </div>

          <ProgressCircle progress={progress} />
        </div>
      </section>

      {/* 미지정 업무 경고 */}
      {hasUnassignedTasks ? (
        <section className="rounded-[22px] border-l-4 border-[#f0a625] bg-[#fffaf0] px-4 py-4 shadow-[0_8px_24px_rgba(67,55,120,0.07)]">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#fff0c9] text-[#dc941c]">
              !
            </span>

            <div className="flex-1">
              <h3 className="text-[13px] font-bold text-[#b8780d]">
                담당자 미정 업무가 있어요
              </h3>

              <p className="mt-2 text-[12px] leading-5 text-[#716a75]">
                현재 업무량이 가장 적은 팀원에게 자동으로 다시 배정할 수 있어요.
              </p>

              <button
                type="button"
                onClick={onAutoRedistribute}
                className="mt-3 rounded-xl bg-[#6259e8] px-4 py-2.5 text-[12px] font-bold text-white shadow-[0_8px_18px_rgba(98,89,232,0.25)]"
              >
                자동 재분배
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 팀원 역할 */}
      <section>
        <div className="mb-3 flex items-center justify-between px-1">
          <div>
            <h3 className="text-[16px] font-extrabold text-[#282438]">
              팀원 역할
            </h3>
            <p className="mt-1 text-[11px] text-[#9891a4]">
              AI가 팀원 성향에 맞는 업무를 추천해요.
            </p>
          </div>

          <span className="rounded-full bg-[#efedff] px-3 py-1.5 text-[10px] font-bold text-[#6259e8]">
            AI 추천
          </span>
        </div>

        <div className="space-y-3">
          {activeMembers.map((member, index) => {
            const memberTasks = tasks.filter(
              (task) =>
                task.assigneeId === member.id && task.status !== "done",
            ).length;

            return (
              <article
                key={member.id}
                className="rounded-[22px] border border-[#eeeaf7] bg-white p-4 shadow-[0_8px_24px_rgba(64,52,115,0.07)]"
              >
                <div className="flex items-center gap-3">
                  <MemberAvatar
                    name={member.name}
                    index={index}
                    large
                    avatarUrl={resolveMemberAvatarUrl(member)}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14px] font-extrabold text-[#332f42]">
                        {member.name}
                      </p>

                      <span className="rounded-full bg-[#f4f2fa] px-2.5 py-1 text-[9px] font-bold text-[#777087]">
                        {member.skillTag}
                      </span>
                    </div>

                    <p className="mt-1 truncate text-[11px] text-[#918a9e]">
                      {member.role}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onRequestMemberExit(member.id)}
                    className="rounded-full bg-[#fff1f5] px-3 py-2 text-[10px] font-bold text-[#df4775]"
                  >
                    나가기
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-[16px] bg-[#faf9ff] px-3 py-3">
                  <p className="text-[11px] leading-5 text-[#7d768b]">
                    {member.skillTag} 성향에 맞는 정리와 연결 업무를 추천해요.
                  </p>

                  <span className="ml-3 shrink-0 text-[11px] font-bold text-[#6259e8]">
                    {memberTasks}개 진행
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* 칸반 업무 목록 */}
      {columns.map((column) => {
        const filteredTasks = tasks.filter(
          (task) => task.status === column.id,
        );

        return (
          <section key={column.id}>
            <div className="mb-3 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-extrabold text-[#2d293b] sm:text-base lg:text-lg">
                  {column.label}
                </h3>

                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${column.badgeClass}`}
                >
                  {filteredTasks.length}
                </span>
              </div>

              <button
                type="button"
                onClick={onAddTask}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[20px] font-light text-[#6259e8] shadow-[0_5px_15px_rgba(73,61,130,0.12)]"
                aria-label={`${column.label} 업무 추가`}
              >
                +
              </button>
            </div>

            <p className="mb-3 px-1 text-[10px] text-[#9b95a8]">
              {column.description}
            </p>

            <div className="space-y-3">
              {filteredTasks.map((task) => {
                const assignee = members.find(
                  (member) => member.id === task.assigneeId,
                );

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onAdvanceTask(task.id)}
                    className={`w-full rounded-[22px] border border-[#eeeaf7] border-l-4 bg-white p-4 text-left shadow-[0_9px_25px_rgba(64,52,115,0.08)] transition active:scale-[0.99] ${column.accentClass}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <PriorityBadge priority={task.priority} />

                          <span className="text-[10px] font-semibold text-[#aaa4b4]">
                            {task.dueLabel}
                          </span>
                        </div>

                        <h4 className="mt-3 line-clamp-2 break-words text-[14px] font-extrabold leading-6 text-[#343044] sm:text-[15px]">
                          {task.title}
                        </h4>

                        {task.aiSuggestedRole ? (
                          <p className="mt-2 line-clamp-2 break-words text-[11px] leading-5 text-[#8e879a] sm:text-xs">
                            {task.aiSuggestedRole}
                          </p>
                        ) : null}
                      </div>

                      <span className="text-[18px] text-[#aaa4b4]">⋯</span>
                    </div>

                    {task.status === "inProgress" ? (
                      <div className="mt-4">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-[#9992a6]">
                            진행률
                          </span>
                          <span className="text-[10px] font-bold text-[#d6257d]">
                            60%
                          </span>
                        </div>

                        <div className="h-1.5 overflow-hidden rounded-full bg-[#f0edf5]">
                          <div className="h-full w-3/5 rounded-full bg-[#d6257d]" />
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 flex items-center justify-between border-t border-[#f1eef6] pt-3">
                      <div className="flex items-center gap-2">
                        <MemberAvatar
                          name={assignee?.name ?? "미정"}
                          index={0}
                          small
                        />

                        <span className="text-[10px] font-semibold text-[#817a8e]">
                          {assignee?.name ?? "담당자 미정"}
                        </span>
                      </div>

                      <span className="text-[9px] font-semibold text-[#aaa4b3]">
                        탭해서 상태 변경
                      </span>
                    </div>
                  </button>
                );
              })}

              {filteredTasks.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-[#ddd8e9] bg-white px-4 py-7 text-center">
                  <p className="text-[12px] font-semibold text-[#8e879a]">
                    아직 등록된 업무가 없어요.
                  </p>

                  <button
                    type="button"
                    onClick={onAddTask}
                    className="mt-3 text-[11px] font-bold text-[#6259e8]"
                  >
                    새 업무 추가
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}

      {/* 이전 팀원 */}
      {formerMembers.length > 0 ? (
        <section>
          <h3 className="mb-3 px-1 text-[14px] font-extrabold text-[#4e485c]">
            이전 팀원
          </h3>

          <div className="space-y-2">
            {formerMembers.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-3 rounded-[20px] border border-dashed border-[#ddd8e9] bg-white px-4 py-4 opacity-70"
              >
                <MemberAvatar
                  name={member.name}
                  index={0}
                  avatarUrl={resolveMemberAvatarUrl(member)}
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold text-[#514b5e]">
                    {member.name}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-[#9b94a6]">
                    {member.role}
                  </p>
                </div>

                <span className="rounded-full bg-[#f2f0f5] px-3 py-1 text-[9px] font-bold text-[#847d8f]">
                  이전 팀원
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ProgressCircle({ progress }: { progress: number }) {
  const safeProgress = Math.max(0, Math.min(progress, 100));
  const radius = 27;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safeProgress / 100) * circumference;

  return (
    <div className="relative h-[74px] w-[74px] shrink-0">
      <svg
        viewBox="0 0 70 70"
        className="h-full w-full -rotate-90"
        aria-label={`업무 달성률 ${safeProgress}%`}
      >
        <circle
          cx="35"
          cy="35"
          r={radius}
          fill="none"
          stroke="#ebe8f4"
          strokeWidth="6"
        />

        <circle
          cx="35"
          cy="35"
          r={radius}
          fill="none"
          stroke="#6259e8"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>

      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[15px] font-extrabold text-[#5148df]">
          {safeProgress}%
        </span>
      </div>
    </div>
  );
}

function MemberAvatar({
  name,
  index,
  large = false,
  small = false,
  avatarUrl,
}: {
  name: string;
  index: number;
  large?: boolean;
  small?: boolean;
  avatarUrl?: string | null;
}) {
  const backgroundClasses = [
    "bg-[#f8d9c0] text-[#6f4e37]",
    "bg-[#d8e8ff] text-[#3d5b89]",
    "bg-[#eadcff] text-[#665080]",
    "bg-[#d8f3e8] text-[#3f6a59]",
  ];

  const sizeClass = large
    ? "h-11 w-11 text-[12px]"
    : small
      ? "h-6 w-6 text-[8px]"
      : "h-9 w-9 text-[10px]";

  const hasAvatar = Boolean(avatarUrl);

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white font-extrabold ${sizeClass} ${
        backgroundClasses[index % backgroundClasses.length]
      }`}
    >
      {hasAvatar ? (
        <Image
          src={avatarUrl ?? ""}
          alt={`${name} 프로필 이미지`}
          fill
          sizes={sizeClass.includes("w-11") ? "44px" : sizeClass.includes("w-6") ? "24px" : "36px"}
          className="object-cover"
        />
      ) : (
        <UserAvatarIcon />
      )}
    </span>
  );
}

function UserAvatarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5 text-current"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="8" r="4" />
    </svg>
  );
}

function resolveMemberAvatarUrl(member: TeamMember) {
  const extendedMember = member as TeamMember & {
    avatarUrl?: string | null;
    profileImageUrl?: string | null;
    imageUrl?: string | null;
    photoUrl?: string | null;
  };

  return (
    extendedMember.avatarUrl ??
    extendedMember.profileImageUrl ??
    extendedMember.imageUrl ??
    extendedMember.photoUrl ??
    null
  );
}

function PriorityBadge({
  priority,
}: {
  priority: Task["priority"];
}) {
  const priorityMap = {
    high: {
      label: "긴급",
      className: "bg-[#fff0f3] text-[#df365f]",
    },
    medium: {
      label: "보통",
      className: "bg-[#fff7e8] text-[#cf8a1c]",
    },
    low: {
      label: "낮음",
      className: "bg-[#eef8f3] text-[#4f9273]",
    },
  };

  const current = priorityMap[priority];

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[9px] font-extrabold ${current.className}`}
    >
      {current.label}
    </span>
  );
}
