import AWS from "aws-sdk";
import os from "os";
import path from "path";
import { writeFile } from "fs/promises";

let s3Client: AWS.S3 | null = null;

function getS3ServerClient() {
  const region = process.env.AWS_REGION || "ap-southeast-2";
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("AWS credentials are not configured");
  }

  AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region,
  });

  if (!s3Client) {
    s3Client = new AWS.S3({ region });
  }

  return s3Client;
}

export async function downloadFileFromS3(fileKey: string) {
  try {
    const bucket = process.env.S3_BUCKET_NAME;

    if (!bucket) {
      throw new Error("S3_BUCKET_NAME is not configured");
    }
    const s3 = getS3ServerClient();
    const params = {
      Bucket: bucket,
      Key: fileKey,
    };

    const obj = await s3.getObject(params).promise();
    const file_name = path.join(os.tmpdir(), `pdf-${Date.now()}.pdf`);
    await writeFile(file_name, obj.Body as Buffer);

    return file_name;
  } catch (error) {
    console.error("Error downloading file from S3:", error);
    return null;
  }
}