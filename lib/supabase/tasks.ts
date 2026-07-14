import {
  hasSupabaseConfig,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/config";

export type TaskStatus = "todo" | "inProgress" | "done";
export type TaskPriority = "high" | "medium" | "low";

export type TaskRow = {
  id: string;
  team_id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string;
  ai_suggested_role: string | null;
  completed_at: string | null;
  created_at: string;
};

export type CreateTaskInput = {
  teamId: string;
  title: string;
  description?: string;
  assigneeId?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string;
  aiSuggestedRole?: string;
};

export type UpdateTaskInput = {
  title?: string;
  description?: string;
  assigneeId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueAt?: string;
  aiSuggestedRole?: string;
};

type SupabaseErrorPayload = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

type TaskQueryResult<T> = {
  ok: boolean;
  data?: T;
  message: string;
};

function normalizeText(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function parseErrorMessage(response: Response) {
  const fallbackMessage = await response.text();
  let detail = fallbackMessage;

  try {
    const parsed = JSON.parse(fallbackMessage) as SupabaseErrorPayload;
    detail = parsed.message ?? parsed.details ?? fallbackMessage;
  } catch {
    // The response body is not always JSON.
  }

  return detail;
}

function getHeaders() {
  return {
    apikey: supabasePublishableKey,
    Authorization: `Bearer ${supabasePublishableKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

function ensureSupabaseConfig() {
  if (!hasSupabaseConfig()) {
    return {
      ok: false as const,
      message:
        "Supabase 환경변수가 없습니다. .env.local에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 넣어주세요.",
    };
  }

  return null;
}

export async function getTasksByTeam(teamId: string): Promise<TaskQueryResult<TaskRow[]>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/tasks?team_id=eq.${encodeURIComponent(teamId)}&select=*&order=created_at.desc`,
    {
      method: "GET",
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
    },
  );

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `Supabase tasks 조회 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as TaskRow[];

  return {
    ok: true,
    data: rows,
    message: "tasks 조회 성공",
  };
}

export async function createTask(
  input: CreateTaskInput,
): Promise<TaskQueryResult<TaskRow>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/tasks?select=*`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      team_id: input.teamId,
      title: input.title,
      description: normalizeText(input.description),
      assignee_id: input.assigneeId ?? null,
      status: input.status,
      priority: input.priority,
      due_at: input.dueAt,
      ai_suggested_role: normalizeText(input.aiSuggestedRole),
    }),
  });

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `Supabase task 생성 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as TaskRow[];

  return {
    ok: true,
    data: rows[0],
    message: "task 생성 성공",
  };
}

export async function updateTaskFields(
  taskId: string,
  updates: UpdateTaskInput,
): Promise<TaskQueryResult<TaskRow>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const payload: Partial<TaskRow> = {};

  if (updates.title !== undefined) {
    payload.title = updates.title;
  }
  if (updates.description !== undefined) {
    payload.description = normalizeText(updates.description);
  }
  if (updates.assigneeId !== undefined) {
    payload.assignee_id = updates.assigneeId;
  }
  if (updates.status !== undefined) {
    payload.status = updates.status;
    if (updates.status === "done") {
      payload.completed_at = new Date().toISOString();
    } else {
      payload.completed_at = null;
    }
  }
  if (updates.priority !== undefined) {
    payload.priority = updates.priority;
  }
  if (updates.dueAt !== undefined) {
    payload.due_at = updates.dueAt;
  }
  if (updates.aiSuggestedRole !== undefined) {
    payload.ai_suggested_role = normalizeText(updates.aiSuggestedRole);
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}&select=*`,
    {
      method: "PATCH",
      headers: getHeaders(),
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `Supabase task 수정 실패: ${detail}`,
    };
  }

  const rows = (await response.json()) as TaskRow[];

  return {
    ok: true,
    data: rows[0],
    message: "task 수정 성공",
  };
}

export async function deleteTask(taskId: string): Promise<TaskQueryResult<null>> {
  const configError = ensureSupabaseConfig();
  if (configError) {
    return configError;
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
      },
    },
  );

  if (!response.ok) {
    const detail = await parseErrorMessage(response);
    return {
      ok: false,
      message: `Supabase task 삭제 실패: ${detail}`,
    };
  }

  return {
    ok: true,
    data: null,
    message: "task 삭제 성공",
  };
}
