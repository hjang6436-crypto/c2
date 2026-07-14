import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { hasSupabaseConfig, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";
import { FileCategory } from "@/types/carrymate";

export const TEAM_FILES_BUCKET = "team-files";
export const TEAM_FILE_MAX_BYTES = 20 * 1024 * 1024;

const SUPPORTED_EXTENSION_TO_MIME: Record<string, string[]> = {
  pdf: ["application/pdf"],
  ppt: ["application/vnd.ms-powerpoint"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  txt: ["text/plain"],
  zip: ["application/zip", "application/x-zip-compressed", "multipart/x-zip"],
};

const MIME_TO_CATEGORY: Record<string, FileCategory> = {
  "application/pdf": "minutes",
  "application/vnd.ms-powerpoint": "materials",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "materials",
  "application/msword": "minutes",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "minutes",
  "application/vnd.ms-excel": "references",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "references",
  "image/png": "references",
  "image/jpeg": "references",
  "text/plain": "minutes",
  "application/zip": "references",
  "application/x-zip-compressed": "references",
  "multipart/x-zip": "references",
};

const EXTENSION_TO_CATEGORY: Record<string, FileCategory> = {
  pdf: "minutes",
  ppt: "materials",
  pptx: "materials",
  doc: "minutes",
  docx: "minutes",
  xls: "references",
  xlsx: "references",
  png: "references",
  jpg: "references",
  jpeg: "references",
  txt: "minutes",
  zip: "references",
};

export type SharedFileRow = {
  id: string;
  team_id: string;
  name: string;
  category: FileCategory;
  uploaded_by: string;
  latest_version_id: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type FileVersionRow = {
  id: string;
  shared_file_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string;
  created_at: string;
};

export type TeamFileRecord = {
  sharedFile: SharedFileRow;
  latestVersion: FileVersionRow | null;
};

type Result<T> = {
  ok: boolean;
  data?: T;
  message: string;
};

type UploadProgressHandler = (percent: number) => void;

type UploadFileInput = {
  teamId: string;
  uploadedBy: string;
  file: File;
  category?: FileCategory;
};

function ensureConfig() {
  if (!hasSupabaseConfig()) {
    return {
      ok: false as const,
      message:
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY를 확인해 주세요.",
    };
  }

  return null;
}

function getExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  if (index < 0) {
    return "";
  }

  return fileName.slice(index + 1).trim().toLowerCase();
}

function sanitizeFileName(fileName: string) {
  return fileName.trim().replace(/[\\/]+/g, "_") || "file";
}

export function inferFileCategory(fileName: string, mimeType?: string | null): FileCategory {
  if (mimeType && MIME_TO_CATEGORY[mimeType]) {
    return MIME_TO_CATEGORY[mimeType];
  }

  const extension = getExtension(fileName);
  return EXTENSION_TO_CATEGORY[extension] ?? "references";
}

export function normalizeStoredFileCategory(category?: string | null): FileCategory {
  const normalized = category?.trim().toLowerCase();

  if (normalized === "minutes") {
    return "minutes";
  }

  if (normalized === "presentation" || normalized === "materials") {
    return "presentation";
  }

  if (normalized === "reference" || normalized === "links" || normalized === "other") {
    return "reference";
  }

  return "reference";
}

export function isExternalLink(value?: string | null) {
  return Boolean(value && /^https?:\/\//i.test(value.trim()));
}

export function validateResourceUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return {
      ok: false,
      message: "URL을 입력해 주세요.",
    };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        ok: false,
        message: "http:// 또는 https:// URL만 허용됩니다.",
      };
    }
  } catch {
    return {
      ok: false,
      message: "유효한 URL 형식이 아닙니다.",
    };
  }

  return {
    ok: true,
    message: "",
  };
}

export function validateTeamFile(file: File): {
  ok: boolean;
  message: string;
  extension?: string;
  mimeType?: string;
  category?: FileCategory;
} {
  const extension = getExtension(file.name);
  if (!extension || !(extension in SUPPORTED_EXTENSION_TO_MIME)) {
    return {
      ok: false,
      message: "지원하지 않는 파일 형식입니다.",
    };
  }

  if (file.size > TEAM_FILE_MAX_BYTES) {
    return {
      ok: false,
      message: "파일 크기는 20MB 이하만 업로드할 수 있습니다.",
    };
  }

  const mimeType = file.type?.trim() ?? "";
  const allowedMimes = SUPPORTED_EXTENSION_TO_MIME[extension] ?? [];
  if (mimeType && !allowedMimes.includes(mimeType)) {
    return {
      ok: false,
      message: "파일 MIME 형식이 허용 목록과 일치하지 않습니다.",
    };
  }

  return {
    ok: true,
    message: "",
    extension,
    mimeType: mimeType || undefined,
    category: inferFileCategory(file.name, mimeType || undefined),
  };
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value).replace(/%2F/gi, "/");
}

function buildStoragePath(teamId: string, uploadId: string, fileName: string) {
  return `${teamId}/${uploadId}/${sanitizeFileName(fileName)}`;
}

function uploadToStorage({
  file,
  storagePath,
  onProgress,
}: {
  file: File;
  storagePath: string;
  onProgress?: UploadProgressHandler;
}): Promise<Result<{ path: string }>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const url = `${supabaseUrl}/storage/v1/object/${TEAM_FILES_BUCKET}/${storagePath
      .split("/")
      .map(encodePathSegment)
      .join("/")}`;

    xhr.open("POST", url, true);
    xhr.setRequestHeader("apikey", supabasePublishableKey);
    xhr.setRequestHeader("Authorization", `Bearer ${supabasePublishableKey}`);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) {
        return;
      }

      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress(percent);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          ok: true,
          data: { path: storagePath },
          message: "Storage 업로드가 완료되었습니다.",
        });
        return;
      }

      resolve({
        ok: false,
        message: xhr.responseText || "Storage 업로드에 실패했습니다.",
      });
    };

    xhr.onerror = () => {
      resolve({
        ok: false,
        message: "네트워크 오류로 Storage 업로드에 실패했습니다.",
      });
    };

    xhr.send(file);
  });
}

export async function uploadTeamFile(
  input: UploadFileInput,
  onProgress?: UploadProgressHandler,
): Promise<Result<TeamFileRecord>> {
  const configError = ensureConfig();
  if (configError) {
    return configError;
  }

  const validation = validateTeamFile(input.file);
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message,
    };
  }

  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 클라이언트 생성에 실패했습니다. 환경변수를 확인해 주세요.",
    };
  }

  const uploadId = crypto.randomUUID();
  const storagePath = buildStoragePath(input.teamId, uploadId, input.file.name);

  const uploadResult = await uploadToStorage({
    file: input.file,
    storagePath,
    onProgress,
  });

  if (!uploadResult.ok) {
    return {
      ok: false,
      message: uploadResult.message,
    };
  }

  onProgress?.(100);

  const category =
    input.category && input.category !== "links"
      ? normalizeStoredFileCategory(input.category)
      : validation.category ?? inferFileCategory(input.file.name, input.file.type);

  const sharedFileResult = await supabase
    .from("shared_files")
    .insert({
      team_id: input.teamId,
      name: input.file.name,
      category,
      uploaded_by: input.uploadedBy,
      latest_version_id: null,
    })
    .select("*")
    .single();

  if (sharedFileResult.error || !sharedFileResult.data) {
    return {
      ok: false,
      message: `shared_files 생성에 실패했습니다: ${sharedFileResult.error?.message ?? ""}`.trim(),
    };
  }

  const sharedFile = sharedFileResult.data as SharedFileRow;

  const versionResult = await supabase
    .from("file_versions")
    .insert({
      shared_file_id: sharedFile.id,
      storage_path: storagePath,
      file_name: input.file.name,
      mime_type: input.file.type || null,
      file_size: input.file.size,
      uploaded_by: input.uploadedBy,
    })
    .select("*")
    .single();

  if (versionResult.error || !versionResult.data) {
    return {
      ok: false,
      message: `file_versions 생성에 실패했습니다: ${versionResult.error?.message ?? ""}`.trim(),
    };
  }

  const version = versionResult.data as FileVersionRow;

  const updateResult = await supabase
    .from("shared_files")
    .update({
      latest_version_id: version.id,
    })
    .eq("id", sharedFile.id)
    .select("*")
    .single();

  if (updateResult.error) {
    return {
      ok: false,
      message: `shared_files 최신 버전 갱신에 실패했습니다: ${updateResult.error.message}`,
    };
  }

  return {
    ok: true,
    data: {
      sharedFile: updateResult.data as SharedFileRow,
      latestVersion: version,
    },
    message: "파일 업로드가 완료되었습니다.",
  };
}

export type CreateTeamLinkInput = {
  teamId: string;
  uploadedBy: string;
  title: string;
  url: string;
  category: FileCategory;
  note?: string;
};

export type UpdateTeamResourceInput = {
  title: string;
  category: FileCategory;
  url?: string;
  note?: string;
};

export async function createTeamLinkResource(
  input: CreateTeamLinkInput,
): Promise<Result<TeamFileRecord>> {
  const configError = ensureConfig();
  if (configError) {
    return configError;
  }

  const urlValidation = validateResourceUrl(input.url);
  if (!urlValidation.ok) {
    return {
      ok: false,
      message: urlValidation.message,
    };
  }

  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 클라이언트를 사용할 수 없습니다. 환경변수를 확인해 주세요.",
    };
  }

  const sharedFileResult = await supabase
    .from("shared_files")
    .insert({
      team_id: input.teamId,
      name: input.title.trim(),
      category: input.category,
      uploaded_by: input.uploadedBy,
      latest_version_id: null,
    })
    .select("*")
    .single();

  if (sharedFileResult.error || !sharedFileResult.data) {
    return {
      ok: false,
      message: `shared_files 생성에 실패했습니다: ${sharedFileResult.error?.message ?? ""}`.trim(),
    };
  }

  const sharedFile = sharedFileResult.data as SharedFileRow;

  const versionResult = await supabase
    .from("file_versions")
    .insert({
      shared_file_id: sharedFile.id,
      storage_path: input.url.trim(),
      file_name: input.title.trim(),
      mime_type: "text/uri-list",
      file_size: 0,
      uploaded_by: input.uploadedBy,
    })
    .select("*")
    .single();

  if (versionResult.error || !versionResult.data) {
    return {
      ok: false,
      message: `file_versions 생성에 실패했습니다: ${versionResult.error?.message ?? ""}`.trim(),
    };
  }

  const version = versionResult.data as FileVersionRow;

  const updateResult = await supabase
    .from("shared_files")
    .update({
      latest_version_id: version.id,
    })
    .eq("id", sharedFile.id)
    .select("*")
    .single();

  if (updateResult.error) {
    return {
      ok: false,
      message: `shared_files 최신 버전 갱신에 실패했습니다: ${updateResult.error.message}`,
    };
  }

  return {
    ok: true,
    data: {
      sharedFile: updateResult.data as SharedFileRow,
      latestVersion: version,
    },
    message: "링크 등록이 완료되었습니다.",
  };
}

export async function updateTeamResource(
  sharedFileId: string,
  input: UpdateTeamResourceInput,
): Promise<Result<TeamFileRecord>> {
  const configError = ensureConfig();
  if (configError) {
    return configError;
  }

  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 클라이언트를 사용할 수 없습니다. 환경변수를 확인해 주세요.",
    };
  }

  const sharedFileResult = await supabase
    .from("shared_files")
    .update({
      name: input.title.trim(),
      category: input.category,
    })
    .eq("id", sharedFileId)
    .select("*")
    .single();

  if (sharedFileResult.error || !sharedFileResult.data) {
    return {
      ok: false,
      message: `shared_files 수정에 실패했습니다: ${sharedFileResult.error?.message ?? ""}`.trim(),
    };
  }

  const latestVersionResult = await supabase
    .from("file_versions")
    .select("*")
    .eq("shared_file_id", sharedFileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (latestVersionResult.error || !latestVersionResult.data) {
    return {
      ok: false,
      message: `file_versions 조회에 실패했습니다: ${latestVersionResult.error?.message ?? ""}`.trim(),
    };
  }

  const latestVersion = latestVersionResult.data as FileVersionRow;
  const versionUpdate: Record<string, unknown> = {
    file_name: input.title.trim(),
  };

  if (isExternalLink(latestVersion.storage_path) && input.url) {
    const urlValidation = validateResourceUrl(input.url);
    if (!urlValidation.ok) {
      return {
        ok: false,
        message: urlValidation.message,
      };
    }

    versionUpdate.storage_path = input.url.trim();
    versionUpdate.mime_type = "text/uri-list";
    versionUpdate.file_size = 0;
  }

  const versionUpdateResult = await supabase
    .from("file_versions")
    .update(versionUpdate)
    .eq("id", latestVersion.id)
    .select("*")
    .single();

  if (versionUpdateResult.error || !versionUpdateResult.data) {
    return {
      ok: false,
      message: `file_versions 수정에 실패했습니다: ${versionUpdateResult.error?.message ?? ""}`.trim(),
    };
  }

  const refreshedSharedFileResult = await supabase
    .from("shared_files")
    .update({
      latest_version_id: versionUpdateResult.data.id,
    })
    .eq("id", sharedFileId)
    .select("*")
    .single();

  if (refreshedSharedFileResult.error || !refreshedSharedFileResult.data) {
    return {
      ok: false,
      message: `shared_files 최신 버전 갱신에 실패했습니다: ${refreshedSharedFileResult.error?.message ?? ""}`.trim(),
    };
  }

  return {
    ok: true,
    data: {
      sharedFile: refreshedSharedFileResult.data as SharedFileRow,
      latestVersion: versionUpdateResult.data as FileVersionRow,
    },
    message: "자료가 수정되었습니다.",
  };
}

export async function deleteTeamResource(sharedFileId: string): Promise<Result<null>> {
  const configError = ensureConfig();
  if (configError) {
    return configError;
  }

  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 클라이언트를 사용할 수 없습니다. 환경변수를 확인해 주세요.",
    };
  }

  const latestVersionResult = await supabase
    .from("file_versions")
    .select("*")
    .eq("shared_file_id", sharedFileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (latestVersionResult.error && latestVersionResult.error.code !== "PGRST116") {
    return {
      ok: false,
      message: `file_versions 조회에 실패했습니다: ${latestVersionResult.error.message}`,
    };
  }

  const latestVersion = latestVersionResult.data as FileVersionRow | null;
  if (latestVersion && !isExternalLink(latestVersion.storage_path)) {
    const { error: removeError } = await supabase.storage
      .from(TEAM_FILES_BUCKET)
      .remove([latestVersion.storage_path]);

    if (removeError) {
      return {
        ok: false,
        message: `Storage 삭제에 실패했습니다: ${removeError.message}`,
      };
    }
  }

  const versionDeleteResult = await supabase
    .from("file_versions")
    .delete()
    .eq("shared_file_id", sharedFileId);

  if (versionDeleteResult.error) {
    return {
      ok: false,
      message: `file_versions 삭제에 실패했습니다: ${versionDeleteResult.error.message}`,
    };
  }

  const sharedFileDeleteResult = await supabase
    .from("shared_files")
    .delete()
    .eq("id", sharedFileId);

  if (sharedFileDeleteResult.error) {
    return {
      ok: false,
      message: `shared_files 삭제에 실패했습니다: ${sharedFileDeleteResult.error.message}`,
    };
  }

  return {
    ok: true,
    data: null,
    message: "자료가 삭제되었습니다.",
  };
}

export async function getTeamFiles(teamId: string): Promise<Result<TeamFileRecord[]>> {
  const configError = ensureConfig();
  if (configError) {
    return configError;
  }

  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 클라이언트를 사용할 수 없습니다. 환경변수를 확인해 주세요.",
    };
  }

  const sharedFilesResult = await supabase
    .from("shared_files")
    .select("*")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });

  if (sharedFilesResult.error) {
    return {
      ok: false,
      message: `shared_files 조회에 실패했습니다: ${sharedFilesResult.error.message}`,
    };
  }

  const sharedFiles = (sharedFilesResult.data ?? []) as SharedFileRow[];
  if (sharedFiles.length === 0) {
    return {
      ok: true,
      data: [],
      message: "파일 목록이 비어 있습니다.",
    };
  }

  const latestVersionIds = sharedFiles
    .map((file) => file.latest_version_id)
    .filter((value): value is string => Boolean(value));

  const versionRows =
    latestVersionIds.length > 0
      ? await supabase
          .from("file_versions")
          .select("*")
          .in("id", latestVersionIds)
      : { data: [], error: null };

  if (versionRows.error) {
    return {
      ok: false,
      message: `file_versions 조회에 실패했습니다: ${versionRows.error.message}`,
    };
  }

  const versions = (versionRows.data ?? []) as FileVersionRow[];
  const versionById = new Map(versions.map((version) => [version.id, version]));

  return {
    ok: true,
    data: sharedFiles.map((sharedFile) => ({
      sharedFile,
      latestVersion: sharedFile.latest_version_id
        ? versionById.get(sharedFile.latest_version_id) ?? null
        : null,
    })),
    message: "파일 목록을 불러왔습니다.",
  };
}

export async function getTeamFileSignedUrl(storagePath: string): Promise<Result<string>> {
  const configError = ensureConfig();
  if (configError) {
    return configError;
  }

  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return {
      ok: false,
      message:
        "Supabase 클라이언트를 사용할 수 없습니다. 환경변수를 확인해 주세요.",
    };
  }

  const { data, error } = await supabase.storage
    .from(TEAM_FILES_BUCKET)
    .createSignedUrl(storagePath, 60);

  if (error || !data?.signedUrl) {
    return {
      ok: false,
      message: `다운로드 링크 생성에 실패했습니다: ${error?.message ?? ""}`.trim(),
    };
  }

  return {
    ok: true,
    data: data.signedUrl,
    message: "다운로드 링크를 생성했습니다.",
  };
}
