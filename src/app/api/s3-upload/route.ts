import { NextResponse } from "next/server";
import {
  buildS3FileKey,
  validatePdfUpload,
} from "@/lib/server/s3-upload";
import { createRequestTimer } from "@/lib/server/request-timing";
import { toErrorDetails, toErrorResponse } from "@/lib/server/errors";
import { withTimeout } from "@/lib/server/timeout";

const S3_CLIENT_INIT_TIMEOUT_MS = 15000;
const SIGNED_URL_TIMEOUT_MS = 15000;

let awsModulePromise: Promise<typeof import("aws-sdk")> | null = null;

function getAwsModule() {
  if (!awsModulePromise) {
    awsModulePromise = import("aws-sdk");
  }
  return awsModulePromise;
}

async function getS3Client(region: string) {
  const AWS = await getAwsModule();
  AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region,
  });

  return new AWS.S3({ region, signatureVersion: "v4" });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const timer = createRequestTimer("/api/s3-upload", requestId);
  try {
    console.log(`[/api/s3-upload][${requestId}] request_received`, {
      method: request.method,
      contentType: request.headers.get("content-type") ?? "unknown",
    });
    const configCheckStartedAt = Date.now();
    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return NextResponse.json(
        { error: "AWS credentials are not configured" },
        { status: 500 }
      );
    }
    timer.stage("aws_credentials_checked", configCheckStartedAt);

    const bucket = process.env.S3_BUCKET_NAME;
    const region = process.env.AWS_REGION || "ap-southeast-2";

    if (!bucket) {
      return NextResponse.json(
        { error: "S3_BUCKET_NAME is not configured" },
        { status: 500 }
      );
    }

    const s3ClientStartedAt = Date.now();
    const s3 = await withTimeout(
      getS3Client(region),
      S3_CLIENT_INIT_TIMEOUT_MS,
      "Timed out while initializing S3 client."
    );
    timer.stage("s3_client_ready", s3ClientStartedAt);

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      return NextResponse.json({
        error:
          "Unsupported content type. Send JSON metadata to /api/s3-upload and upload the file directly to S3 using the returned signedUrl.",
      }, { status: 415 });
    }

    let payload: { fileName?: string; fileType?: string; fileSize?: unknown };
    try {
      const parseJsonStartedAt = Date.now();
      payload = (await request.json()) as typeof payload;
      timer.stage("json_payload_parsed", parseJsonStartedAt);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { fileName, fileType, fileSize } = payload;

    if (!fileName) {
      return NextResponse.json(
        { error: "fileName is required" },
        { status: 400 }
      );
    }

    const validationError = validatePdfUpload(fileType, typeof fileSize === "number" ? fileSize : undefined);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const file_key = buildS3FileKey(String(fileName));

    const signUrlStartedAt = Date.now();
    const signedUrl = await withTimeout(
      s3.getSignedUrlPromise("putObject", {
        Bucket: bucket,
        Key: file_key,
        ContentType: fileType || "application/pdf",
        Expires: 60,
      }),
      SIGNED_URL_TIMEOUT_MS,
      "Timed out while generating S3 signed URL."
    );
    timer.stage("signed_url_generated", signUrlStartedAt, { fileKey: file_key });
    timer.total("request_completed", { mode: "signed-url", fileKey: file_key });

    return NextResponse.json({ signedUrl, file_key, file_name: fileName, requestId });
  } catch (error) {
    console.error(`[/api/s3-upload][${requestId}] failed`, toErrorDetails(error));
    return toErrorResponse(error, "Failed to generate upload URL.");
  }
}
