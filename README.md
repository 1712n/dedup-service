# Deduplication Service
A high-performance service designed to eliminate duplicate and near-duplicate content, ensuring diversity and token uniqueness in datasets. Built on Cloudflare Workers. Used in [ELTEX](https://github.com/Kseymur/eltex-sheets-addon). 
> 🤖 Powered by [WALL-E](https://github.com/1712n/wall-e), a GitHub bot that supercharges spec-driven development through automated generation of Cloudflare Workers. 

## Implementation approach

This service demonstrates how to effectively handle exact and semantic duplicates in data collection workflows:
- **Cloudflare Workers + Workers AI**: Vector embeddings ([bge-m3](https://developers.cloudflare.com/workers-ai/models/bge-m3/) for semantic comparison
- **PostgreSQL + pgvector**: Vector storage and cosine similarity search
- **Two-stage filtering**: Content hash filtering → Vector similarity threshold
