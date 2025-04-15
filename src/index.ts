interface Message {
  message_id: string;
  timestamp: string;
  content: string;
  platform_name: string;
  platform_user_id: string;
  platform_message_id: string;
  platform_message_url: string;
}

interface BatchRequest {
  table_name: string;
  job_id: string;
  topic: string;
  industry: string;
  subindustry: string;
  similarity_search_score_threshold: number;
  filter_by?: string[];
  messages: Message[];
}

interface BatchResponse {
  status: string;
  data: {
    table_name: string;
    job_id: string;
    topic: string;
    industry: string;
    subindustry: string;
    similarity_search_score_threshold: number;
    filter_by: string[];
    stats: {
      received: number;
      inserted: number;
      dropped: number;
      insertion_rate: number;
    };
    non_duplicate_messages: {
      message_id: string;
      content: string;
    }[];
  };
  message: string;
}

interface Env {
  AI: {
    run(
      model: string,
      inputs: { text: string[] },
    ): Promise<{ data: number[][] }>;
  };
  HYPERDRIVE: { connectionString: string };
  DEDUP_AUTH_TOKEN: string;
}

import { Client } from "pg";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise {
    try {
      const authHeader = request.headers.get("Authorization");
      if (
        !authHeader ||
        !authHeader.startsWith("Bearer ") ||
        authHeader.substring(7) !== env.DEDUP_AUTH_TOKEN
      ) {
        console.log("INFO: Authentication failed");
        return new Response(
          JSON.stringify({ status: "error", message: "Unauthorized" }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (request.method !== "POST") {
        console.log("INFO: Method not allowed");
        return new Response(
          JSON.stringify({ status: "error", message: "Method not allowed" }),
          {
            status: 405,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      let data: BatchRequest;
      try {
        data = await request.json();
      } catch (e) {
        console.log("ERROR: Invalid JSON in request");
        return new Response(
          JSON.stringify({ status: "error", message: "Invalid JSON" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (
        !data.table_name ||
        !data.job_id ||
        !data.topic ||
        !data.industry ||
        data.similarity_search_score_threshold === undefined ||
        !Array.isArray(data.messages)
      ) {
        console.log("INFO: Missing required fields in request");
        return new Response(
          JSON.stringify({
            status: "error",
            message: "Missing required fields",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const filter_by = data.filter_by || ["topic", "subindustry"];
      console.log(
        `INFO: Processing batch for job_id=${data.job_id}, messages=${data.messages.length}`,
      );
      const result = await processBatch(data, filter_by, env);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("ERROR: Request processing failed:", error);
      return new Response(
        JSON.stringify({ status: "error", message: "Internal server error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
};

async function processBatch(
  data: BatchRequest,
  filter_by: string[],
  env: Env,
): Promise {
  const dbClient = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
  });

  try {
    await dbClient.connect();
    console.log(`INFO: Connected to database, job_id=${data.job_id}`);

    const stats = {
      received: data.messages.length,
      inserted: 0,
      dropped: 0,
      insertion_rate: 0,
    };

    // Remove exact duplicates
    const contentSet = new Set();
    const uniqueMessages: Message[] = [];

    for (const msg of data.messages) {
      if (!contentSet.has(msg.content)) {
        contentSet.add(msg.content);
        uniqueMessages.push(msg);
      }
    }

    stats.dropped = stats.received - uniqueMessages.length;
    console.log(
      `INFO: ${stats.dropped} exact duplicates removed, job_id=${data.job_id}`,
    );

    // Process for similarity with embeddings
    const nonDuplicateMessages: Message[] = [];
    const embeddingBatchSize = 100;

    // Process in batches for embeddings
    for (let i = 0; i < uniqueMessages.length; i += embeddingBatchSize) {
      const batch = uniqueMessages.slice(i, i + embeddingBatchSize);
      const contents = batch.map((msg) => msg.content);

      try {
        console.log(
          `INFO: Generating embeddings batch ${Math.floor(i / embeddingBatchSize) + 1}/${Math.ceil(uniqueMessages.length / embeddingBatchSize)}`,
        );
        const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: contents,
        });

        // Process each message
        for (let j = 0; j < batch.length; j++) {
          const message = batch[j];
          try {
            const embedding = embeddings.data[j];
            const formattedEmbedding = `[${embedding.join(",")}]`;

            // Prepare query conditions
            const whereConditions: string[] = [];
            const queryParams: any[] = [];
            let paramIndex = 1;

            filter_by.forEach((field) => {
              if (field === "topic" && data.topic) {
                whereConditions.push(`topic = $${paramIndex++}`);
                queryParams.push(data.topic);
              } else if (field === "industry" && data.industry) {
                whereConditions.push(`industry = $${paramIndex++}`);
                queryParams.push(data.industry);
              } else if (field === "subindustry" && data.subindustry) {
                whereConditions.push(`subindustry = $${paramIndex++}`);
                queryParams.push(data.subindustry);
              } else if (field === "job_id" && data.job_id) {
                whereConditions.push(`job_id = $${paramIndex++}`);
                queryParams.push(data.job_id);
              }
            });

            const whereClause =
              whereConditions.length > 0
                ? `WHERE ${whereConditions.join(" AND ")}`
                : "";

            // Check similarity with existing records
            const similarityQuery = `
              SELECT content, 1 - (embedding <=> $${paramIndex}::vector) as similarity_score
              FROM ${data.table_name} ${whereClause}
              ORDER BY embedding <=> $${paramIndex}::vector
              LIMIT 1;
            `;

            queryParams.push(formattedEmbedding);
            const result = await dbClient.query(similarityQuery, queryParams);

            let similarityScore = 0;
            if (result.rows.length > 0) {
              similarityScore = result.rows[0].similarity_score;
            }

            // Insert if similarity is below threshold
            if (similarityScore < data.similarity_search_score_threshold) {
              console.log(
                `INFO: Inserting message_id=${message.message_id}, similarity=${similarityScore.toFixed(4)}`,
              );

              await dbClient.query(
                `
                INSERT INTO ${data.table_name} (
                  job_id, message_id, timestamp, topic, industry, subindustry, content, 
                  embedding, similarity_search_score, platform_name, platform_user_id, 
                  platform_message_id, platform_message_url
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
              `,
                [
                  data.job_id,
                  message.message_id,
                  message.timestamp,
                  data.topic,
                  data.industry,
                  data.subindustry,
                  message.content,
                  formattedEmbedding,
                  similarityScore,
                  message.platform_name,
                  message.platform_user_id,
                  message.platform_message_id,
                  message.platform_message_url,
                ],
              );

              nonDuplicateMessages.push(message);
            } else {
              stats.dropped++;
              console.log(
                `INFO: Dropping similar message_id=${message.message_id}, similarity=${similarityScore.toFixed(4)}`,
              );
            }
          } catch (error) {
            console.error(
              `ERROR: Processing message_id=${message.message_id} failed:`,
              error,
            );
            throw error;
          }
        }
      } catch (error) {
        console.error(`ERROR: Embedding generation failed:`, error);
        throw error;
      }
    }

    // Update stats and prepare response
    stats.inserted = nonDuplicateMessages.length;
    stats.insertion_rate = stats.inserted / stats.received;

    console.log(
      `INFO: Processing complete. Inserted=${stats.inserted}, Dropped=${stats.dropped}`,
    );

    return {
      status: "success",
      data: {
        table_name: data.table_name,
        job_id: data.job_id,
        topic: data.topic,
        industry: data.industry,
        subindustry: data.subindustry,
        similarity_search_score_threshold:
          data.similarity_search_score_threshold,
        filter_by: filter_by,
        stats: stats,
        non_duplicate_messages: nonDuplicateMessages.map((msg) => ({
          message_id: msg.message_id,
          content: msg.content,
        })),
      },
      message: "Batch processing completed successfully",
    };
  } catch (error) {
    console.error(`ERROR: Batch processing failed:`, error);
    throw error;
  } finally {
    try {
      await dbClient.end();
    } catch (e) {
      console.error("ERROR: Failed to close database connection:", e);
    }
  }
}
