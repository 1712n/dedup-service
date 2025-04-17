# Deduplication Service
A high-performance service designed to eliminate duplicate and near-duplicate content, ensuring diversity and token uniqueness in datasets. Built on Cloudflare Workers.
> ✨ Powered by [wall-e](https://github.com/1712n/wall-e), a GitHub bot that supercharges spec-driven development through automated generation of Cloudflare Workers. 

## Implementation approach

This service demonstrates how to effectively handle exact and semantic duplicates in data collection workflows:
- **Cloudflare Workers + AI**: Vector embeddings (bge-base-en-v1.5) for semantic comparison
- **PostgreSQL + pgvector**: Vector storage and cosine similarity search
- **Two-stage filtering**: Content hash filtering → Vector similarity threshold
