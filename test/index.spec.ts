/**
 * # Functional Requirements - Deduplicated Insert REST Service
 * Deduplicated Insert REST Service is a Cloudflare Worker used for duplicate and near-duplicate removal and content diversity. It processes batches of social media messages and inserts unique messages into a pgvector-enabled TimescaleDB table after making sure their similarity search scores stay under a given similarity search score threshold.
 * 
 * ## Key Functionality
 * - Exact text match duplicates are removed immediately after being received.
 * - Near-duplicates are removed based on the provided similarity search score threshold value:
 *    - Vector embeddings can be obtained from a Cloudflare Workers AI embedding model (bge-m3).
 *    - Similarity search scores are obtained from the closest match (highest similarity score) when performing a search against existing db records filtered by fields specified in the `filter_by` parameter. Any messages with similarity search scores exceeding the batch-level similarity search score threshold are dropped. Only messages with similarity search scores under the threshold value are inserted into the database. 
 *    - Each newly inserted message becomes part of the existing records for subsequent message checks. The sequential processing ensures that only the first occurrence of similar messages within a batch will be inserted.
 *
 * ## REST Input
 * The worker provides an HTTP API endpoint that accepts a batch of messages with the following JSON structure:
 *
 * ```json
 * {
 *   "table_name": "messages",
 *   "job_id": "job_123456",
 *   "topic": "cyberattack",
 *   "industry": "finance",
 *   "subindustry": "blockchain",
 *   "similarity_search_score_threshold": 0.9,
 *   "filter_by": ["topic", "subindustry", "job_id"], // optional, default value is ["topic", "subindustry"]
 *   "messages": [
 *     {
 *       "message_id": "msg_001",
 *       "timestamp": "2023-05-15T14:30:00Z",
 *       "content": "AI is revolutionizing the tech industry!",
 *       "platform_name": "Twitter", 
 *       "platform_user_id": "user123",
 *       "platform_message_id": "tweet456",
 *       "platform_message_url": "https://twitter.com/user123/status/tweet456"
 *     },
 *     {
 *       "message_id": "msg_002",
 *       "timestamp": "2023-05-15T14:35:00Z",
 *       "content": "Machine learning applications are on the rise.",
 *       "platform_name": "Discord",
 *       "platform_user_id": "user789",
 *       "platform_message_id": "post012",
 *       "platform_message_url": "https://www.discord.com/channel/channel012"
 *     }
 *   ]
 * }
 * ```
 *
 * ## REST Output
 * The worker returns a JSON response with the following structure:
 *
 * ```json
 * {
 *   "status": "success",
 *   "data": {
 *     "table_name": "messages",
 *     "job_id": "job_123456",
 *     "topic": "cyberattack",
 *     "industry": "finance",
 *     "subindustry": "blockchain",
 *     "similarity_search_score_threshold": 0.9,
 *     "filter_by": ["topic", "subindustry", "job_id"]
 *     "stats": {
 *       "received": 50,
 *       "inserted": 40,
 *       "dropped": 10, // total number of dropped messages that includes both exact duplicates and messages exceeding the similarity threshold
 *       "insertion_rate": 0.8
 *     },
 *     "non_duplicate_messages": [
 *       {
 *         "message_id": "msg_001",
 *         "content": "AI is revolutionizing the tech industry!",
 *       },
 *       {
 *         "message_id": "msg_002",
 *         "content": "Machine learning applications are on the rise.",
 *       }
 *     ]
 *   },
 *   "message": "Batch processing completed successfully"
 * }
 * ```
 * 
 * ## Specific Priorities
 * - Authentication: The worker implements API Key authentication to ensure secure access to the service. 
 * - Batching: The worker implements batching up to 100 messages when obtaining embeddings, respecting Cloudflare Workers AI embedding model limits.
 * 
 * ## PostgreSQL DB Schema
 * ```sql
 * -- Base table structure shared by scraped_messages, synth_data_prod, synth_data_research, eltex_synth_data
 * id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
 * job_id TEXT NOT NULL,
 * message_id TEXT NOT NULL,
 * timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
 * topic TEXT NOT NULL,
 * industry TEXT NOT NULL,
 * subindustry TEXT,
 * content TEXT NOT NULL,
 * embedding VECTOR(1024) NOT NULL,
 * similarity_search_score REAL NOT NULL,
 * platform_name TEXT,
 * platform_user_id TEXT,
 * platform_message_id TEXT,
 * platform_message_url TEXT
 * ```
 * 
 * ## Additional Documentation
 * ### Hyperdrive Usage with TimescaleDB
 * ```ts
 * import { Client } from "pg";
 * const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
 * await client.connect();
 * ```
 * ### Workers AI native binding 
 * ```ts
 * const resp = await env.AI.run(modelName, { text: inputs });
 * const embedding = resp.data[j];
 * const formattedEmbedding = `[${embedding.join(',')}]`;
 * ```
 * * ### Vector Search using pgvector
 * ```ts
 * SELECT content
 * FROM table
 * ORDER BY embedding <=> $1::vector
 * LIMIT 1;
 * ```
 */


import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    AI: Ai;
    HYPERDRIVE: Hyperdrive;
    DEDUP_AUTH_TOKEN: string;
  }
}
