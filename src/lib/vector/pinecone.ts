import { Pinecone } from "@pinecone-database/pinecone";
import { downloadFileFromS3 } from "../s3-server";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { unlink } from "fs/promises";
import { readFile } from "fs/promises";
import { getEmbeddingsClient } from "../ai/embeddings";
import { toVectorNamespace } from "../chat/namespace";

export type PdfChunk = {
  id: string;
  pageContent: string;
  metadata: {
    pageNumber: number | null;
    chunkIndex: number;
    fileKey: string;
    fileName: string | null;
    source: string | null;
  };
};

let pinecone: Pinecone | null = null;
const EMBEDDING_BATCH_SIZE = 40;
const UPSERT_BATCH_SIZE = 100;

export const getPineconeClient = () => {
  if (!pinecone) {
    pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
  }
  return pinecone;
};

function assertPineconeConfig() {
  if (!process.env.PINECONE_INDEX_NAME) {
    throw new Error("PINECONE_INDEX_NAME is not configured");
  }
}

export async function loadS3IntoPinecone(
  fileKey: string,
  fileName?: string,
  options?: { requestId?: string; chatId?: number }
): Promise<PdfChunk[]> {
  const requestId = options?.requestId ?? "n/a";
  const chatId = options?.chatId ?? "n/a";
  const runStart = Date.now();
  const logPrefix = `[indexing][requestId=${requestId}][chatId=${chatId}][fileKey=${fileKey}]`;
  const stage = (name: string, startedAt: number, extra?: Record<string, unknown>) => {
    console.log(`${logPrefix} ${name}`, {
      durationMs: Date.now() - startedAt,
      ...(extra ?? {}),
    });
  };

  console.log(`${logPrefix} started`);
  assertPineconeConfig();

  const downloadStartedAt = Date.now();
  const tempFile = await downloadFileFromS3(fileKey);
  stage("s3_download_completed", downloadStartedAt, { tempFile });

  if (!tempFile) {
    throw new Error("Failed to download file from S3");
  }

  try {
    const parseStartedAt = Date.now();
    // Force v1 parser entrypoint to avoid fallback test-file behavior.
    const pdfParseModule = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = pdfParseModule.default as (buffer: Buffer) => Promise<{
      text?: string;
      numpages?: number;
    }>;
    const fileBuffer = await readFile(tempFile);
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error(`Downloaded PDF is empty: ${tempFile}`);
    }
    const parsed = await pdfParse(fileBuffer);
    const fullText = String(parsed.text ?? "").trim();
    stage("pdf_loaded", parseStartedAt, {
      tempFile,
      bytes: fileBuffer.length,
      pages: typeof parsed.numpages === "number" ? parsed.numpages : null,
      textLength: fullText.length,
    });
    if (!fullText) {
      throw new Error("No text was extracted from the uploaded PDF.");
    }

    const splitStartedAt = Date.now();
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const rawChunks = await splitter.splitText(fullText);
    const chunks: PdfChunk[] = rawChunks.map((chunkText, index) => ({
      id: `${fileKey}-chunk-${index}`,
      pageContent: chunkText,
      metadata: {
        pageNumber: null,
        chunkIndex: index,
        fileKey,
        fileName: fileName ?? null,
        source: null,
      },
    }));
    stage("chunks_created", splitStartedAt, { chunks: chunks.length });

    if (chunks.length === 0) {
      console.log(`${logPrefix} no_chunks_found`);
      return [];
    }
    const nonEmptyChunks = chunks.filter((chunk) => chunk.pageContent.trim().length > 0);
    if (nonEmptyChunks.length === 0) {
      throw new Error("PDF text extraction produced only empty chunks.");
    }
    if (nonEmptyChunks.length !== chunks.length) {
      console.log(`${logPrefix} empty_chunks_filtered`, {
        originalChunks: chunks.length,
        nonEmptyChunks: nonEmptyChunks.length,
      });
    }

    const embeddingStartedAt = Date.now();
    const embeddings = getEmbeddingsClient();
    const vectors: number[][] = [];
    const totalEmbeddingBatches = Math.ceil(nonEmptyChunks.length / EMBEDDING_BATCH_SIZE);
    for (let offset = 0; offset < nonEmptyChunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const batchStartedAt = Date.now();
      const batch = nonEmptyChunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const embeddedBatch = await embeddings.embedDocuments(
        batch.map((chunk) => chunk.pageContent)
      );
      vectors.push(...embeddedBatch);
      stage("embedding_batch_completed", batchStartedAt, {
        batchNumber: Math.floor(offset / EMBEDDING_BATCH_SIZE) + 1,
        totalBatches: totalEmbeddingBatches,
        batchSize: batch.length,
      });
    }
    stage("all_embeddings_completed", embeddingStartedAt, {
      vectors: vectors.length,
      dimensions: vectors[0]?.length ?? 0,
    });

    const upsertStartedAt = Date.now();
    const pineconeClient = getPineconeClient();
    const indexName = process.env.PINECONE_INDEX_NAME!;
    const index = pineconeClient.index(indexName);
    const namespace = toVectorNamespace(fileKey);
    console.log(`${logPrefix} pinecone_target_resolved`, { indexName, namespace });

    const totalUpsertBatches = Math.ceil(nonEmptyChunks.length / UPSERT_BATCH_SIZE);
    for (let offset = 0; offset < nonEmptyChunks.length; offset += UPSERT_BATCH_SIZE) {
      const batchStartedAt = Date.now();
      const chunkBatch = nonEmptyChunks.slice(offset, offset + UPSERT_BATCH_SIZE);
      await index.namespace(namespace).upsert({
        records: chunkBatch.map((chunk, batchIndex) => {
          const vectorIndex = offset + batchIndex;
          return {
            id: chunk.id,
            values: vectors[vectorIndex],
            metadata: {
              text: chunk.pageContent,
              chunkIndex: chunk.metadata.chunkIndex,
              fileKey: chunk.metadata.fileKey,
              ...(typeof chunk.metadata.pageNumber === "number"
                ? { pageNumber: chunk.metadata.pageNumber }
                : {}),
              ...(chunk.metadata.fileName ? { fileName: chunk.metadata.fileName } : {}),
              ...(chunk.metadata.source ? { source: chunk.metadata.source } : {}),
            },
          };
        }),
      });
      stage("upsert_batch_completed", batchStartedAt, {
        batchNumber: Math.floor(offset / UPSERT_BATCH_SIZE) + 1,
        totalBatches: totalUpsertBatches,
        batchSize: chunkBatch.length,
        namespace,
      });
    }
    stage("all_upserts_completed", upsertStartedAt, { namespace, chunks: chunks.length });
    stage("indexing_completed", runStart, {
      totalChunks: chunks.length,
      indexedChunks: nonEmptyChunks.length,
      indexName,
      namespace,
    });

    return nonEmptyChunks;
  } finally {
    await unlink(tempFile).catch(() => {});
  }
}
