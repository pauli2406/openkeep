import { useState, useRef, useCallback } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Upload as UploadIcon,
  File,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { getAccessToken } from "@/lib/api";

export const Route = createFileRoute("/upload")({
  component: UploadPage,
});

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/heic",
];

const ACCEPTED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.tiff,.tif,.heic";

type FileStatus = "pending" | "uploading" | "done" | "error";

interface QueuedFile {
  id: string;
  file: File;
  titleOverride: string;
  status: FileStatus;
  errorMessage?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function UploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [allDone, setAllDone] = useState(false);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newItems: QueuedFile[] = [];
    for (const file of Array.from(files)) {
      if (
        ACCEPTED_TYPES.includes(file.type) ||
        file.name.toLowerCase().endsWith(".heic")
      ) {
        newItems.push({
          id: crypto.randomUUID(),
          file,
          titleOverride: "",
          status: "pending",
        });
      }
    }
    if (newItems.length > 0) {
      setQueue((prev) => [...prev, ...newItems]);
      setAllDone(false);
    }
  }, []);

  function removeFile(id: string) {
    setQueue((prev) => prev.filter((f) => f.id !== id));
  }

  function updateTitle(id: string, title: string) {
    setQueue((prev) =>
      prev.map((f) => (f.id === id ? { ...f, titleOverride: title } : f)),
    );
  }

  function updateFileStatus(
    id: string,
    status: FileStatus,
    errorMessage?: string,
  ) {
    setQueue((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, status, errorMessage } : f,
      ),
    );
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const pendingFiles = queue.filter((f) => f.status === "pending");
      if (pendingFiles.length === 0) return;

      const token = getAccessToken();

      for (const item of pendingFiles) {
        updateFileStatus(item.id, "uploading");

        try {
          const formData = new FormData();
          formData.append("file", item.file);
          if (item.titleOverride.trim()) {
            formData.append("title", item.titleOverride.trim());
          }

          const headers: Record<string, string> = {};
          if (token) {
            headers["Authorization"] = `Bearer ${token}`;
          }

          const response = await fetch("/api/documents", {
            method: "POST",
            headers,
            body: formData,
          });

          if (!response.ok) {
            const body = await response.text();
            let message = `Upload failed (${response.status})`;
            try {
              const parsed = JSON.parse(body);
              if (parsed.message) {
                message = typeof parsed.message === "string"
                  ? parsed.message
                  : parsed.message.join(", ");
              }
            } catch {
              if (body) message = body;
            }
            throw new Error(message);
          }

          updateFileStatus(item.id, "done");
        } catch (err) {
          updateFileStatus(
            item.id,
            "error",
            err instanceof Error ? err.message : "Upload failed",
          );
        }
      }

      setAllDone(true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  }

  const pendingCount = queue.filter((f) => f.status === "pending").length;
  const doneCount = queue.filter((f) => f.status === "done").length;
  const errorCount = queue.filter((f) => f.status === "error").length;
  const isUploading = uploadMutation.isPending;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <UploadIcon className="h-7 w-7" />
          Upload Documents
        </h1>
        <p className="text-muted-foreground">
          Add documents to your archive
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        }`}
      >
        <UploadIcon
          className={`h-10 w-10 ${isDragging ? "text-primary" : "text-muted-foreground"}`}
        />
        <p className="mt-4 text-sm font-medium">
          {isDragging
            ? "Drop files here"
            : "Drag and drop files here, or click to browse"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Supports PDF, JPEG, PNG, TIFF, and HEIC
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS}
          multiple
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>

      {/* File queue */}
      {queue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Files ({queue.length})
            </CardTitle>
            <CardDescription>
              {pendingCount > 0 && `${pendingCount} pending`}
              {doneCount > 0 && `${pendingCount > 0 ? ", " : ""}${doneCount} uploaded`}
              {errorCount > 0 && `${pendingCount > 0 || doneCount > 0 ? ", " : ""}${errorCount} failed`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {queue.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border p-3"
              >
                {/* Status icon */}
                <div className="mt-0.5 shrink-0">
                  {item.status === "pending" && (
                    <File className="h-5 w-5 text-muted-foreground" />
                  )}
                  {item.status === "uploading" && (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  )}
                  {item.status === "done" && (
                    <CheckCircle className="h-5 w-5 text-emerald-500" />
                  )}
                  {item.status === "error" && (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>

                {/* File info */}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {item.file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(item.file.size)}
                      </p>
                    </div>
                    {item.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 shrink-0 p-0"
                        onClick={() => removeFile(item.id)}
                      >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Remove</span>
                      </Button>
                    )}
                  </div>

                  {item.status === "pending" && (
                    <div className="space-y-1">
                      <Label
                        htmlFor={`title-${item.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Title override (optional)
                      </Label>
                      <Input
                        id={`title-${item.id}`}
                        value={item.titleOverride}
                        onChange={(e) => updateTitle(item.id, e.target.value)}
                        placeholder="Auto-detected from content"
                        className="h-8 text-sm"
                      />
                    </div>
                  )}

                  {item.status === "error" && item.errorMessage && (
                    <p className="text-xs text-destructive">
                      {item.errorMessage}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {queue.length > 0 && !allDone && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setQueue([]);
              setAllDone(false);
            }}
            disabled={isUploading}
          >
            Clear all
          </Button>
          <Button
            onClick={() => uploadMutation.mutate()}
            disabled={isUploading || pendingCount === 0}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <UploadIcon className="h-4 w-4" />
                Upload {pendingCount} {pendingCount === 1 ? "file" : "files"}
              </>
            )}
          </Button>
        </div>
      )}

      {/* Success state */}
      {allDone && doneCount > 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <CheckCircle className="h-10 w-10 text-emerald-500" />
            <h3 className="mt-3 text-lg font-semibold">Upload complete</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {doneCount} {doneCount === 1 ? "document was" : "documents were"}{" "}
              uploaded successfully
              {errorCount > 0 && `, ${errorCount} failed`}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" asChild>
                <Link to="/documents">View documents</Link>
              </Button>
              <Button
                onClick={() => {
                  setQueue([]);
                  setAllDone(false);
                }}
              >
                Upload more
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
