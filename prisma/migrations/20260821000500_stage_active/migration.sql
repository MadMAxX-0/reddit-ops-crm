-- Rename the third pipeline stage to the name the team actually uses.
-- An account here is assigned to a creator and in rotation with a poster.
ALTER TYPE "PipelineStage" RENAME VALUE 'CONTENT' TO 'ACTIVE';
