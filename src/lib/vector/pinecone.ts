import { Pinecone } from "@pinecone-database/pinecone";
import { downloadFileFromS3 } from "../s3-server";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { unlink } from "fs/promises";
import { getEmbeddingsClient } from "../ai/embeddings";
import { toVectorNamespace } from "../chat/namespace";

export type PdfPage = {
  pageContent: string;
  metadata: Record<string, unknown>;
};

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
  const file_name = await downloadFileFromS3(fileKey);
  stage("s3_download_completed", downloadStartedAt, { tempFile: file_name });

  if (!file_name) {
    throw new Error("Failed to download file from S3");
  }

  try {
    const parseStartedAt = Date.now();
    const loader = new PDFLoader(file_name);
    const rawPages = await loader.load();
    const pages: PdfPage[] = rawPages.map((page) => ({
      pageContent: String(page.pageContent ?? ""),
      metadata: (page.metadata ?? {}) as Record<string, unknown>,
    }));
    stage("pdf_loaded", parseStartedAt, { pages: pages.length });

    const splitStartedAt = Date.now();
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const chunks: PdfChunk[] = [];

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      const pageChunks = await splitter.splitText(page.pageContent);
      for (let i = 0; i < pageChunks.length; i++) {
        const pageNumber =
          typeof page.metadata.loc === "object" &&
          page.metadata.loc !== null &&
          "pageNumber" in page.metadata.loc
            ? Number((page.metadata.loc as { pageNumber?: number }).pageNumber ?? null)
            : pageIndex + 1;

        chunks.push({
          id: `${fileKey}-${pageNumber ?? pageIndex + 1}-${i}`,
          pageContent: pageChunks[i],
          metadata: {
            pageNumber,
            chunkIndex: i,
            fileKey,
            fileName: fileName ?? null,
            source:
              typeof page.metadata.source === "string"
                ? page.metadata.source
                : null,
          },
        });
      }
    }
    stage("chunks_created", splitStartedAt, { chunks: chunks.length });

    if (chunks.length === 0) {
      console.log(`${logPrefix} no_chunks_found`);
      return [];
    }

    const embeddingStartedAt = Date.now();
    const embeddings = getEmbeddingsClient();
    const vectors: number[][] = [];
    const totalEmbeddingBatches = Math.ceil(chunks.length / EMBEDDING_BATCH_SIZE);
    for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const batchStartedAt = Date.now();
      const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
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
    stage("all_embeddings_completed", embeddingStartedAt, { vectors: vectors.length });

    const upsertStartedAt = Date.now();
    const pineconeClient = getPineconeClient();
    const index = pineconeClient.index(process.env.PINECONE_INDEX_NAME!);
    const namespace = toVectorNamespace(fileKey);

    const totalUpsertBatches = Math.ceil(chunks.length / UPSERT_BATCH_SIZE);
    for (let offset = 0; offset < chunks.length; offset += UPSERT_BATCH_SIZE) {
      const batchStartedAt = Date.now();
      const chunkBatch = chunks.slice(offset, offset + UPSERT_BATCH_SIZE);
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
    stage("indexing_completed", runStart, { totalChunks: chunks.length });

    return chunks;
  } finally {
    await unlink(file_name).catch(() => {});
  }
}
