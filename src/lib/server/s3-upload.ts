const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export function sanitizeUploadName(fileName: string) {
  return fileName.replace(/\s+/g, "-");
}

export function buildS3FileKey(fileName: string) {
  return `uploads/${Date.now()}-${sanitizeUploadName(fileName)}`;
}

export function validatePdfUpload(fileType?: string, fileSize?: number) {
  if ((fileType || "application/pdf") !== "application/pdf") {
    return "Only PDF files are allowed";
  }

  if (typeof fileSize === "number" && fileSize > MAX_UPLOAD_SIZE_BYTES) {
    return "File size should be less than 10MB";
  }

  return null;
}
