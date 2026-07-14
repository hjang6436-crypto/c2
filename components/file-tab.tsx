import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ModalShell } from "@/components/modal-shell";
import { normalizeStoredFileCategory } from "@/lib/supabase/files";
import type { FileCategory, FileItem } from "@/types/carrymate";

type UploadResult = {
  ok: boolean;
  message: string;
};

type CreateLinkInput = {
  title: string;
  url: string;
  category: FileCategory;
  note?: string;
};

type UpdateResourceInput = {
  title: string;
  category: FileCategory;
  url?: string;
  note?: string;
};

type FileTabProps = {
  files: FileItem[];
  canUpload: boolean;
  createDialogRequestId?: number;
  syncMessage?: string;
  onUploadFile?: (
    file: File,
    category: FileCategory,
    onProgress: (percent: number) => void,
  ) => Promise<UploadResult>;
  onCreateLink?: (input: CreateLinkInput) => Promise<UploadResult>;
  onUpdateResource?: (
    file: FileItem,
    input: UpdateResourceInput,
  ) => Promise<UploadResult>;
  onDeleteResource?: (file: FileItem) => Promise<UploadResult>;
  onDownloadFile?: (file: FileItem) => Promise<UploadResult>;
  onOpenLink?: (file: FileItem) => Promise<UploadResult>;
};

type DialogMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; file: FileItem }
  | { kind: "delete"; file: FileItem };

const CATEGORY_META: Record<
  "minutes" | "presentation" | "reference",
  { title: string; icon: string; tone: string }
> = {
  minutes: {
    title: "회의록",
    icon: "DOC",
    tone: "bg-blue-50 text-blue-600",
  },
  presentation: {
    title: "발표자료",
    icon: "PPT",
    tone: "bg-rose-50 text-rose-600",
  },
  reference: {
    title: "참고자료",
    icon: "REF",
    tone: "bg-emerald-50 text-emerald-600",
  },
};

const CATEGORY_OPTIONS: Array<{ value: FileCategory; label: string }> = [
  { value: "minutes", label: "회의록" },
  { value: "presentation", label: "발표자료" },
  { value: "reference", label: "참고자료" },
];

const FILE_ACCEPT_VALUE = [
  ".pdf",
  ".ppt",
  ".pptx",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".txt",
  ".zip",
].join(",");


function getUiCategory(file: FileItem) {
  return normalizeStoredFileCategory(file.category);
}

function isLinkItem(file: FileItem) {
  return file.resourceType === "link" || Boolean(file.resourceUrl?.startsWith("http"));
}

function formatUploadedLabel(value: string) {
  return value || "-";
}

export function FileTab({
  files,
  canUpload,
  createDialogRequestId,
  syncMessage,
  onUploadFile,
  onCreateLink,
  onUpdateResource,
  onDeleteResource,
  onDownloadFile,
  onOpenLink,
}: FileTabProps) {
  const [query, setQuery] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [dialogMode, setDialogMode] = useState<DialogMode>({ kind: "closed" });
  const [resourceType, setResourceType] = useState<"file" | "link">("file");
  const [selectedCategory, setSelectedCategory] = useState<FileCategory>("reference");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState<FileCategory>("reference");
  const [editUrl, setEditUrl] = useState("");
  const [editNote, setEditNote] = useState("");
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<FileCategory | "all">("all");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCreateDialogRequestIdRef = useRef(0);

  const visibleFiles = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return files.filter((file) => {
      if (activeCategoryFilter !== "all" && getUiCategory(file) !== activeCategoryFilter) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return [
        file.name,
        file.uploadedBy,
        getUiCategory(file),
        isLinkItem(file) ? "링크" : "파일",
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [activeCategoryFilter, files, query]);

  const counts = useMemo(
    () => ({
      minutes: files.filter((file) => getUiCategory(file) === "minutes").length,
      presentation: files.filter((file) => getUiCategory(file) === "presentation").length,
      reference: files.filter((file) => getUiCategory(file) === "reference").length,
    }),
    [files],
  );
  const statusMessage = message || syncMessage;

  const closeDialog = () => {
    setDialogMode({ kind: "closed" });
    setMessage("");
  };

  const openCreateDialog = useCallback(() => {
    if (!canUpload) {
      setMessage("실제 UUID 팀에서만 자료 업로드를 사용할 수 있습니다.");
      return;
    }

    setDialogMode({ kind: "create" });
    setResourceType("file");
    setSelectedCategory("reference");
    setLinkTitle("");
    setLinkUrl("");
    setLinkNote("");
    setMessage("");
  }, [canUpload]);

  useEffect(() => {
    if (!createDialogRequestId || createDialogRequestId === lastCreateDialogRequestIdRef.current) {
      return;
    }

    lastCreateDialogRequestIdRef.current = createDialogRequestId;
    openCreateDialog();
  }, [createDialogRequestId, openCreateDialog]);

  const openEditDialog = (file: FileItem) => {
    setDialogMode({ kind: "edit", file });
    setEditTitle(file.name);
    setEditCategory(getUiCategory(file));
    setEditUrl(file.resourceUrl ?? file.storagePath ?? "");
    setEditNote(file.note ?? "");
    setMessage("");
  };

  const openDeleteDialog = (file: FileItem) => {
    setDialogMode({ kind: "delete", file });
    setMessage("");
  };

  const uploadSelectedFile = async (file: File | null) => {
    if (!file || !onUploadFile) {
      return;
    }

    setIsUploading(true);
    setMessage("");
    setUploadProgress(0);

    const result = await onUploadFile(file, selectedCategory, (percent) => {
      setUploadProgress(percent);
    });

    setIsUploading(false);
    setUploadProgress(result.ok ? 100 : 0);
    setMessage(result.message);

    if (result.ok && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCreateLink = async () => {
    if (!onCreateLink) {
      setMessage("링크 등록 기능을 사용할 수 없습니다.");
      return;
    }

    const result = await onCreateLink({
      title: linkTitle,
      url: linkUrl,
      category: selectedCategory,
      note: linkNote,
    });

    setMessage(result.message);
    if (result.ok) {
      closeDialog();
    }
  };

  const handleSaveEdit = async () => {
    if (dialogMode.kind !== "edit" || !onUpdateResource) {
      return;
    }

    const file = dialogMode.file;
    const result = await onUpdateResource(file, {
      title: editTitle,
      category: editCategory,
      url: isLinkItem(file) ? editUrl : undefined,
      note: editNote,
    });

    setMessage(result.message);
    if (result.ok) {
      closeDialog();
    }
  };

  const handleDelete = async () => {
    if (dialogMode.kind !== "delete" || !onDeleteResource) {
      return;
    }

    const result = await onDeleteResource(dialogMode.file);
    setMessage(result.message);
    if (result.ok) {
      closeDialog();
    }
  };

  const handleDownload = async (file: FileItem) => {
    if (isLinkItem(file)) {
      if (!onOpenLink) {
        setMessage("링크 열기 기능을 사용할 수 없습니다.");
        return;
      }

      setBusyFileId(file.id);
      const result = await onOpenLink(file);
      setBusyFileId(null);
      setMessage(result.message);
      return;
    }

    if (!onDownloadFile) {
      setMessage("다운로드 기능을 사용할 수 없습니다.");
      return;
    }

    setBusyFileId(file.id);
    const result = await onDownloadFile(file);
    setBusyFileId(null);
    setMessage(result.message);
  };

  return (
    <div className="space-y-4 pb-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(["minutes", "presentation", "reference"] as const).map((key) => {
          const meta = CATEGORY_META[key];
          const isSelected = activeCategoryFilter === key;
          return (
            <button
              type="button"
              key={key}
              onClick={() =>
                setActiveCategoryFilter((current) => (current === key ? "all" : key))
              }
              aria-pressed={isSelected}
              className={`group flex h-full min-h-[108px] w-full items-center gap-3 rounded-[22px] border px-4 py-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(64,52,115,0.10)] active:scale-[0.99] ${
                isSelected ? "border-[#cfdaf2] bg-[#f8fbff]" : "border-[#edf0f6] bg-white"
              }`}
              aria-label={`${meta.title} 자료 ${counts[key]}개`}
            >
              <span
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[11px] font-extrabold ${meta.tone}`}
              >
                {meta.icon}
              </span>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-[13px] font-extrabold text-[#403a4d] sm:text-sm lg:text-base">
                  {meta.title}
                </p>
                <p className="mt-1 text-[10px] text-[#8f889b] sm:text-[11px]">
                  {counts[key]}개
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="rounded-[18px] border border-[#ebe7f3] bg-white px-4 py-3 shadow-card transition hover:shadow-[0_12px_28px_rgba(64,52,115,0.08)] focus-within:border-[#cfdaf2] focus-within:shadow-[0_12px_28px_rgba(64,52,115,0.08)]">
        <div className="flex items-center gap-3">
          <span className="text-[#9a94a8]" aria-hidden="true">
            ⌕
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="자료명, 업로더, 카테고리 검색"
            className="min-w-0 w-full bg-transparent text-[12px] outline-none placeholder:text-[#aaa4b5] sm:text-sm lg:text-base"
          />
        </div>
      </div>

      {statusMessage ? (
        <div className="rounded-[18px] border border-[#e7edf8] bg-white px-4 py-3 text-[12px] leading-6 text-[#445066] shadow-card sm:text-sm lg:text-base">
          {statusMessage}
        </div>
      ) : null}

      <div className="space-y-2.5">
        {visibleFiles.length > 0 ? (
          visibleFiles.map((file) => {
            const categoryKey = getUiCategory(file) as keyof typeof CATEGORY_META;
            const meta = CATEGORY_META[categoryKey];
            const isLink = isLinkItem(file);
            const isActionDisabled = !canUpload;
            return (
              <article
                key={file.id}
                className="rounded-[20px] border border-[#edf0f6] bg-white px-4 py-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(64,52,115,0.10)] sm:px-5 sm:py-5"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold sm:h-11 sm:w-11 sm:text-xs ${meta.tone}`}
                  >
                    {isLink ? "URL" : meta.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 break-words text-[12px] font-extrabold text-[#393445] sm:text-[13px] lg:text-base">
                      {file.name}
                    </p>
                    <p className="mt-1 whitespace-nowrap text-[10px] text-[#9a94a7] sm:text-[11px] lg:text-sm">
                      {meta.title} · {isLink ? "링크" : "파일"} · {formatUploadedLabel(file.uploadedBy)} · {file.uploadedAt}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <button
                      type="button"
                      title={isActionDisabled ? "삭제 권한이 없습니다." : undefined}
                      onClick={() => void handleDownload(file)}
                      disabled={isActionDisabled || busyFileId === file.id}
                      className="rounded-full bg-[#f3f7ff] px-3 py-2 text-[11px] font-bold text-[#1e70e6] sm:text-xs lg:text-sm disabled:opacity-60"
                    >
                      {busyFileId === file.id
                        ? "처리 중..."
                        : isLink
                          ? "링크 열기"
                          : "다운로드"}
                    </button>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        disabled={isActionDisabled}
                        onClick={() => openEditDialog(file)}
                        className="min-h-10 rounded-full border border-[#e5e9f2] px-3 py-2 text-[11px] font-semibold text-[#445066] sm:text-xs lg:text-sm disabled:opacity-60"
                      >
                        편집
                      </button>
                      <button
                        type="button"
                        disabled={isActionDisabled}
                        onClick={() => openDeleteDialog(file)}
                        className="min-h-10 rounded-full border border-[#f2d7d7] px-3 py-2 text-[11px] font-semibold text-[#b54d4d] sm:text-xs lg:text-sm disabled:opacity-60"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <Empty onCreate={openCreateDialog} />
        )}
      </div>

      {dialogMode.kind === "create" ? (
        <DialogShell title="자료 추가" onClose={closeDialog}>
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-canvas p-1">
            <ToggleButton active={resourceType === "file"} onClick={() => setResourceType("file")}>
              파일 업로드
            </ToggleButton>
            <ToggleButton active={resourceType === "link"} onClick={() => setResourceType("link")}>
              링크 등록
            </ToggleButton>
          </div>

          <SelectField
            label="카테고리"
            value={selectedCategory}
            onChange={(value) => setSelectedCategory(value as FileCategory)}
            options={CATEGORY_OPTIONS}
          />

          {resourceType === "file" ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-dashed border-[#d8deea] bg-[#fafcff] px-4 py-5 text-center text-[12px] leading-6 text-[#64708a] sm:text-sm lg:text-base break-keep">
                기존 Storage 업로드 흐름을 그대로 사용합니다.
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={FILE_ACCEPT_VALUE}
                className="hidden"
                onChange={(event) => {
                  void uploadSelectedFile(event.target.files?.[0] ?? null);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full min-h-11 rounded-2xl bg-[#1e70e6] px-4 py-4 text-sm font-semibold text-white shadow-brand sm:text-[15px] lg:text-base"
              >
                파일 선택 후 업로드
              </button>
              {isUploading ? (
                <div className="space-y-2">
                  <div className="h-2 overflow-hidden rounded-full bg-[#e7edf8]">
                    <div
                      className="h-full rounded-full bg-[#1e70e6] transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-[11px] font-semibold text-[#1e70e6] sm:text-xs lg:text-sm">
                    업로드 중 {uploadProgress}%
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <InputField label="자료 제목" value={linkTitle} onChange={setLinkTitle} />
              <InputField label="URL" value={linkUrl} onChange={setLinkUrl} placeholder="https://" />
              <TextareaField
                label="선택 메모"
                value={linkNote}
                onChange={setLinkNote}
                placeholder="선택 사항"
              />
              <button
                type="button"
                onClick={() => void handleCreateLink()}
                className="w-full min-h-11 rounded-2xl bg-[#1e70e6] px-4 py-4 text-sm font-semibold text-white shadow-brand sm:text-[15px] lg:text-base"
              >
                링크 등록
              </button>
            </div>
          )}
        </DialogShell>
      ) : null}

      {dialogMode.kind === "edit" ? (
        <DialogShell title="자료 수정" onClose={closeDialog}>
          <InputField label="자료 제목" value={editTitle} onChange={setEditTitle} />
          <SelectField
            label="카테고리"
            value={editCategory}
            onChange={(value) => setEditCategory(value as FileCategory)}
            options={CATEGORY_OPTIONS}
          />
          {isLinkItem(dialogMode.file) ? (
            <>
              <InputField label="URL" value={editUrl} onChange={setEditUrl} placeholder="https://" />
              <TextareaField
                label="선택 메모"
                value={editNote}
                onChange={setEditNote}
              />
            </>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSaveEdit()}
            className="w-full min-h-11 rounded-2xl bg-[#1e70e6] px-4 py-4 text-sm font-semibold text-white shadow-brand sm:text-[15px] lg:text-base"
          >
            저장
          </button>
        </DialogShell>
      ) : null}

      {dialogMode.kind === "delete" ? (
        <ConfirmDialog
          title="자료 삭제"
          body="이 자료를 정말 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다."
          actionLabel="삭제"
          onClose={closeDialog}
          onAction={() => void handleDelete()}
        />
      ) : null}
    </div>
  );
}

function Empty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-[24px] border border-dashed border-[#ddd8e9] bg-white px-5 py-10 text-center shadow-card sm:px-6 sm:py-12">
      <button
        type="button"
        onClick={onCreate}
        aria-label="자료 추가"
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f3f7ff] text-[20px] font-bold text-[#1e70e6] transition hover:scale-[1.03] active:scale-[0.98]"
      >
        +
      </button>
      <p className="mt-4 text-[14px] font-extrabold text-[#282438] sm:text-[15px] lg:text-base">
        아직 등록된 자료가 없습니다.
      </p>
      <p className="mx-auto mt-2 max-w-[18rem] whitespace-pre-line break-keep text-[12px] leading-6 text-[#8f889b] sm:text-sm lg:text-base">
        자료 추가 버튼을 눌러{`\n`}회의록, 발표자료, 참고자료를 등록해 보세요.
      </p>
    </div>
  );
}

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="space-y-4">{children}</div>
    </ModalShell>
  );
}

function ConfirmDialog({
  title,
  body,
  actionLabel,
  onClose,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onClose: () => void;
  onAction: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onClose} tone="confirm">
      <p className="whitespace-pre-line text-[13px] leading-7 text-muted sm:text-sm lg:text-base">{body}</p>
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
          className="rounded-2xl bg-brand px-4 py-3 font-semibold text-white shadow-brand"
        >
          {actionLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
        active ? "bg-white text-ink shadow-soft" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-ink">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-line bg-white px-4 py-3 outline-none transition focus:border-brand"
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-ink">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none rounded-2xl border border-line bg-white px-4 py-3 outline-none transition focus:border-brand"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-ink">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-line bg-white px-4 py-3 outline-none transition focus:border-brand"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

