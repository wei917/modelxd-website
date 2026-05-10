-- Rename provider 'qwen' → 'alibaba' for all DashScope models
UPDATE ai_models SET provider = 'alibaba' WHERE provider = 'qwen';
