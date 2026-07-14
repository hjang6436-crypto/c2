import { FileItem, TeamMember } from "@/types/carrymate";
import {
  TeamFileRecord,
  inferFileCategory,
  isExternalLink,
  normalizeStoredFileCategory,
} from "@/lib/supabase/files";

function formatUploadedAt(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function mapTeamFileRecordsToFileItems(
  records: TeamFileRecord[],
  members: TeamMember[],
): FileItem[] {
  const memberNameById = new Map(members.map((member) => [member.id, member.name]));

  return records.map(({ sharedFile, latestVersion }) => {
    const uploadedByMemberId = sharedFile.uploaded_by ?? null;
    const uploadedBy = memberNameById.get(uploadedByMemberId ?? "") ?? "알 수 없음";
    const fileName = latestVersion?.file_name ?? sharedFile.name;
    const mimeType = latestVersion?.mime_type ?? null;
    const category = normalizeStoredFileCategory(
      sharedFile.category ?? inferFileCategory(fileName, mimeType ?? undefined),
    );
    const resourceType = isExternalLink(latestVersion?.storage_path)
      ? "link"
      : "file";

    return {
      id: sharedFile.id,
      name: fileName,
      category,
      uploadedBy,
      uploadedByMemberId,
      uploadedAt: formatUploadedAt(latestVersion?.created_at ?? sharedFile.created_at),
      statusLabel: "업로드됨",
      isFinal: false,
      source: "storage",
      sharedFileId: sharedFile.id,
      latestVersionId: sharedFile.latest_version_id,
      fileVersionId: latestVersion?.id ?? null,
      storagePath: latestVersion?.storage_path ?? null,
      mimeType,
      fileSizeBytes: latestVersion?.file_size ?? null,
      originalFileName: latestVersion?.file_name ?? sharedFile.name,
      resourceType,
      resourceUrl: isExternalLink(latestVersion?.storage_path)
        ? latestVersion?.storage_path
        : null,
      note: null,
    };
  });
}

