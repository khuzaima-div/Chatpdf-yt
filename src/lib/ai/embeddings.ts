import { OpenAIEmbeddings } from "@langchain/openai";

let embeddingsClient: OpenAIEmbeddings | null = null;
const PINECONE_VECTOR_DIMENSION = 1024;

export const getEmbeddingsClient = () => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    if (!embeddingsClient) {
      embeddingsClient = new OpenAIEmbeddings({
        apiKey: process.env.OPENAI_API_KEY,
        model: "text-embedding-3-small",
        // Match Pinecone index dimension to prevent upsert 400s.
        dimensions: PINECONE_VECTOR_DIMENSION,
      });
    }

    return embeddingsClient;
  } catch (error) {
    console.error("Failed to initialize OpenAI embeddings client:", error);
    throw new Error("OpenAI embeddings client initialization failed");
  }
};
