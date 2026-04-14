import axios from "axios";

const SIGNED_URL_TIMEOUT_MS = 30000;
const S3_PUT_TIMEOUT_MS = 120000;
const SIGNED_URL_RETRY_LIMIT = 1;

function logUploadStage(stage: string, startedAt: number, meta?: Record<string, unknown>) {
  console.log(`[uploadToS3] ${stage}`, {
    durationMs: Date.now() - startedAt,
    ...(meta ?? {}),
  });
}

export async function uploadToS3(
  file: File,
  onProgress?: (progress: number) => void
) {
  const uploadStartedAt = Date.now();
  try {
    console.log("[uploadToS3] started", {
      fileName: file.name,
      fileType: file.type || "application/pdf",
      fileSize: file.size,
    });

    let lastSignedUrlError: unknown;
    let signedUrlResponse:
      | {
          signedUrl: string;
          file_key: string;
          file_name: string;
          requestId?: string;
        }
      | null = null;

    for (let attempt = 0; attempt <= SIGNED_URL_RETRY_LIMIT; attempt++) {
      const signedUrlStartedAt = Date.now();
      try {
        const { data } = await axios.post(
          "/api/s3-upload",
          {
            fileName: file.name,
            fileType: file.type || "application/pdf",
            fileSize: file.size,
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: SIGNED_URL_TIMEOUT_MS,
          }
        );
        signedUrlResponse = data as {
          signedUrl: string;
          file_key: string;
          file_name: string;
          requestId?: string;
        };
        logUploadStage("signed_url_received", signedUrlStartedAt, {
          attempt: attempt + 1,
          requestId: signedUrlResponse.requestId ?? "n/a",
          fileKey: signedUrlResponse.file_key,
        });
        break;
      } catch (error) {
        lastSignedUrlError = error;
        logUploadStage("signed_url_failed", signedUrlStartedAt, {
          attempt: attempt + 1,
          willRetry: attempt < SIGNED_URL_RETRY_LIMIT,
        });
      }
    }

    if (!signedUrlResponse) {
      throw lastSignedUrlError ?? new Error("Failed to fetch signed URL.");
    }

    const { signedUrl, file_key, file_name } = signedUrlResponse as {
      signedUrl: string;
      file_key: string;
      file_name: string;
    };

    const s3UploadStartedAt = Date.now();
    await axios.put(signedUrl, file, {
      headers: {
        "Content-Type": file.type || "application/pdf",
      },
      timeout: S3_PUT_TIMEOUT_MS,
      onUploadProgress: (evt) => {
        if (!evt.total) return;
        const percent = Math.round((evt.loaded * 100) / evt.total);
        onProgress?.(percent);
      },
    });
    logUploadStage("s3_upload_completed", s3UploadStartedAt, {
      fileKey: file_key,
      totalFileBytes: file.size,
    });
    onProgress?.(100);
    logUploadStage("completed", uploadStartedAt, { fileKey: file_key });

    return {
      file_key,
      file_name: file_name ?? file.name,
    };
  } catch (error) {
    console.error("[uploadToS3] failed", error);
    if (axios.isAxiosError(error) && error.code === "ECONNABORTED") {
      throw new Error("Upload request timed out");
    }
    throw error;
  }
}

export function getS3Url(file_key: string) {
  return `https://${process.env.NEXT_PUBLIC_S3_BUCKET_NAME}.s3.${process.env.NEXT_PUBLIC_S3_REGION || "ap-southeast-2"}.amazonaws.com/${file_key}`;
}