-- CreateEnum
CREATE TYPE "Role" AS ENUM ('POSTER', 'FARMER', 'MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CreatorStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CHURNED');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('WARMING', 'READY', 'ACTIVE', 'SHADOWBANNED', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "CreationOutcome" AS ENUM ('SUCCESS', 'FAILED_CREATE', 'FAILED_VERIFY', 'FAILED_CAPTCHA');

-- CreateEnum
CREATE TYPE "SubredditTier" AS ENUM ('S', 'A', 'B', 'C');

-- CreateEnum
CREATE TYPE "SubredditStatus" AS ENUM ('ACTIVE', 'RISKY', 'BANNED_FOR_US');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('LIVE', 'REMOVED', 'DELETED', 'SHADOWBANNED');

-- CreateEnum
CREATE TYPE "AttributionStatus" AS ENUM ('RESOLVED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'GALLERY', 'LINK', 'TEXT');

-- CreateEnum
CREATE TYPE "TrackedLinkStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "FunnelEventType" AS ENUM ('LANDED', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "AttributionType" AS ENUM ('EXACT', 'INFERRED');

-- CreateEnum
CREATE TYPE "ConversionType" AS ENUM ('FREE_SUB', 'TRIAL', 'PAID_SUB', 'PPV', 'TIP');

-- CreateEnum
CREATE TYPE "ReportScope" AS ENUM ('GLOBAL', 'CREATOR', 'VA', 'SUBREDDIT');

-- CreateEnum
CREATE TYPE "ScraperJobType" AS ENUM ('POST_DISCOVERY', 'POST_METRICS', 'REMOVAL_DETECTION', 'ACCOUNT_HEALTH', 'SUBREDDIT_RULES', 'OF_CONVERSION_SYNC');

-- CreateEnum
CREATE TYPE "ScraperJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "PollTier" AS ENUM ('HOT', 'WARM', 'COLD', 'DORMANT');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARN', 'CRITICAL');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dayBoundaryTimezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "funnelBaseUrl" TEXT NOT NULL DEFAULT 'http://localhost:3000/f',
    "attributionWindowH" INTEGER NOT NULL DEFAULT 72,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "dailyAccountGoal" INTEGER NOT NULL DEFAULT 0,
    "dailyPostGoal" INTEGER NOT NULL DEFAULT 0,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "hourlyCostCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "ofUsername" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "revenueSharePct" INTEGER NOT NULL DEFAULT 70,
    "status" "CreatorStatus" NOT NULL DEFAULT 'ACTIVE',
    "niche" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proxy" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "provider" TEXT,
    "countryCode" TEXT,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedditAccount" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordEnc" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "emailProvider" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redditCreatedAt" TIMESTAMP(3),
    "karmaPost" INTEGER NOT NULL DEFAULT 0,
    "karmaComment" INTEGER NOT NULL DEFAULT 0,
    "proxyId" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'WARMING',
    "assignedCreatorId" TEXT,
    "assignedPosterId" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "shadowbanned" BOOLEAN NOT NULL DEFAULT false,
    "suspendedAt" TIMESTAMP(3),
    "verifiedSubreddits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "healthScore" INTEGER NOT NULL DEFAULT 50,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pollTier" "PollTier" NOT NULL DEFAULT 'DORMANT',
    "lastPolledAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "lastPostAt" TIMESTAMP(3),
    "suspectedMissedPosts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RedditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountCreationAttempt" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "batchDate" DATE NOT NULL,
    "outcome" "CreationOutcome" NOT NULL,
    "redditAccountId" TEXT,
    "failureReason" TEXT,
    "proxyId" TEXT,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountCreationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmingSession" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "redditAccountId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMin" INTEGER NOT NULL DEFAULT 0,
    "commentsMade" INTEGER NOT NULL DEFAULT 0,
    "postsMade" INTEGER NOT NULL DEFAULT 0,
    "karmaBefore" INTEGER NOT NULL DEFAULT 0,
    "karmaAfter" INTEGER NOT NULL DEFAULT 0,
    "subredditsTouched" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FarmingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountHealthSnapshot" (
    "id" TEXT NOT NULL,
    "redditAccountId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "karmaPost" INTEGER NOT NULL,
    "karmaComment" INTEGER NOT NULL,
    "shadowbanned" BOOLEAN NOT NULL,
    "suspended" BOOLEAN NOT NULL,
    "healthScore" INTEGER NOT NULL,

    CONSTRAINT "AccountHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subreddit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subscribers" INTEGER NOT NULL DEFAULT 0,
    "isNsfw" BOOLEAN NOT NULL DEFAULT true,
    "verificationRequired" BOOLEAN NOT NULL DEFAULT false,
    "minKarma" INTEGER NOT NULL DEFAULT 0,
    "minAccountAgeDays" INTEGER NOT NULL DEFAULT 0,
    "postCooldownHours" INTEGER NOT NULL DEFAULT 24,
    "allowedFlairs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rulesSummary" TEXT,
    "tier" "SubredditTier" NOT NULL DEFAULT 'C',
    "tierIsManual" BOOLEAN NOT NULL DEFAULT false,
    "status" "SubredditStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastScrapedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subreddit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountAssignment" (
    "id" TEXT NOT NULL,
    "redditAccountId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "posterId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AccountAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "redditPostId" TEXT NOT NULL,
    "redditAccountId" TEXT NOT NULL,
    "subredditId" TEXT NOT NULL,
    "creatorId" TEXT,
    "posterId" TEXT,
    "title" TEXT NOT NULL,
    "flair" TEXT,
    "mediaType" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "url" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "PostStatus" NOT NULL DEFAULT 'LIVE',
    "attributionStatus" "AttributionStatus" NOT NULL DEFAULT 'RESOLVED',
    "removedAt" TIMESTAMP(3),
    "removalReason" TEXT,
    "lastMetricAt" TIMESTAMP(3),
    "latestUpvotes" INTEGER NOT NULL DEFAULT 0,
    "latestComments" INTEGER NOT NULL DEFAULT 0,
    "latestUpvoteRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMetric" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "upvotes" INTEGER NOT NULL,
    "upvoteRatio" DOUBLE PRECISION NOT NULL,
    "comments" INTEGER NOT NULL,
    "rank" INTEGER,
    "estimatedViews" INTEGER,

    CONSTRAINT "PostMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "redditAccountId" TEXT NOT NULL,
    "ofTrackingLinkId" TEXT,
    "funnelUrl" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "status" "TrackedLinkStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "trackedLinkId" TEXT NOT NULL,
    "type" "FunnelEventType" NOT NULL,
    "attributedPostId" TEXT,
    "attributionType" "AttributionType" NOT NULL DEFAULT 'EXACT',
    "attributionWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "countryCode" TEXT,
    "deviceType" TEXT,
    "userAgentHash" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "referrer" TEXT,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "ofTrackingLinkId" TEXT NOT NULL,
    "trackedLinkId" TEXT,
    "creatorId" TEXT NOT NULL,
    "type" "ConversionType" NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowerSnapshot" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followerCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'OF_API',

    CONSTRAINT "FollowerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "scope" "ReportScope" NOT NULL,
    "scopeId" TEXT,
    "kind" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "headline" TEXT,
    "summaryMd" TEXT NOT NULL,
    "findingsJson" JSONB NOT NULL,
    "contextJson" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,
    "model" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScraperJob" (
    "id" TEXT NOT NULL,
    "type" "ScraperJobType" NOT NULL,
    "target" TEXT,
    "status" "ScraperJobStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "errorsCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "ScraperJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScraperConfig" (
    "id" TEXT NOT NULL,
    "type" "ScraperJobType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "intervalSec" INTEGER NOT NULL,
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 60,
    "maxAttempts" INTEGER NOT NULL DEFAULT 4,
    "hotIntervalSec" INTEGER NOT NULL DEFAULT 600,
    "warmIntervalSec" INTEGER NOT NULL DEFAULT 3600,
    "coldIntervalSec" INTEGER NOT NULL DEFAULT 21600,
    "dormantIntervalSec" INTEGER NOT NULL DEFAULT 86400,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScraperConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CreatorPosters" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CreatorPosters_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_stageName_key" ON "Creator"("stageName");

-- CreateIndex
CREATE INDEX "Creator_status_idx" ON "Creator"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Proxy_label_key" ON "Proxy"("label");

-- CreateIndex
CREATE UNIQUE INDEX "RedditAccount_username_key" ON "RedditAccount"("username");

-- CreateIndex
CREATE INDEX "RedditAccount_status_idx" ON "RedditAccount"("status");

-- CreateIndex
CREATE INDEX "RedditAccount_assignedPosterId_status_idx" ON "RedditAccount"("assignedPosterId", "status");

-- CreateIndex
CREATE INDEX "RedditAccount_assignedCreatorId_status_idx" ON "RedditAccount"("assignedCreatorId", "status");

-- CreateIndex
CREATE INDEX "RedditAccount_createdById_createdAt_idx" ON "RedditAccount"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "RedditAccount_nextPollAt_pollTier_idx" ON "RedditAccount"("nextPollAt", "pollTier");

-- CreateIndex
CREATE INDEX "RedditAccount_healthScore_idx" ON "RedditAccount"("healthScore");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCreationAttempt_redditAccountId_key" ON "AccountCreationAttempt"("redditAccountId");

-- CreateIndex
CREATE INDEX "AccountCreationAttempt_farmerId_batchDate_idx" ON "AccountCreationAttempt"("farmerId", "batchDate");

-- CreateIndex
CREATE INDEX "AccountCreationAttempt_batchDate_outcome_idx" ON "AccountCreationAttempt"("batchDate", "outcome");

-- CreateIndex
CREATE INDEX "FarmingSession_farmerId_startedAt_idx" ON "FarmingSession"("farmerId", "startedAt");

-- CreateIndex
CREATE INDEX "FarmingSession_redditAccountId_startedAt_idx" ON "FarmingSession"("redditAccountId", "startedAt");

-- CreateIndex
CREATE INDEX "AccountHealthSnapshot_redditAccountId_capturedAt_idx" ON "AccountHealthSnapshot"("redditAccountId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subreddit_name_key" ON "Subreddit"("name");

-- CreateIndex
CREATE INDEX "Subreddit_tier_status_idx" ON "Subreddit"("tier", "status");

-- CreateIndex
CREATE INDEX "Subreddit_status_idx" ON "Subreddit"("status");

-- CreateIndex
CREATE INDEX "AccountAssignment_redditAccountId_startedAt_idx" ON "AccountAssignment"("redditAccountId", "startedAt");

-- CreateIndex
CREATE INDEX "AccountAssignment_posterId_startedAt_idx" ON "AccountAssignment"("posterId", "startedAt");

-- CreateIndex
CREATE INDEX "AccountAssignment_creatorId_startedAt_idx" ON "AccountAssignment"("creatorId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_redditPostId_key" ON "Post"("redditPostId");

-- CreateIndex
CREATE INDEX "Post_postedAt_idx" ON "Post"("postedAt");

-- CreateIndex
CREATE INDEX "Post_posterId_postedAt_idx" ON "Post"("posterId", "postedAt");

-- CreateIndex
CREATE INDEX "Post_creatorId_postedAt_idx" ON "Post"("creatorId", "postedAt");

-- CreateIndex
CREATE INDEX "Post_subredditId_postedAt_idx" ON "Post"("subredditId", "postedAt");

-- CreateIndex
CREATE INDEX "Post_redditAccountId_postedAt_idx" ON "Post"("redditAccountId", "postedAt");

-- CreateIndex
CREATE INDEX "Post_status_postedAt_idx" ON "Post"("status", "postedAt");

-- CreateIndex
CREATE INDEX "Post_attributionStatus_idx" ON "Post"("attributionStatus");

-- CreateIndex
CREATE INDEX "PostMetric_postId_capturedAt_idx" ON "PostMetric"("postId", "capturedAt");

-- CreateIndex
CREATE INDEX "PostMetric_capturedAt_idx" ON "PostMetric"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_slug_key" ON "TrackedLink"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_ofTrackingLinkId_key" ON "TrackedLink"("ofTrackingLinkId");

-- CreateIndex
CREATE INDEX "TrackedLink_redditAccountId_status_idx" ON "TrackedLink"("redditAccountId", "status");

-- CreateIndex
CREATE INDEX "FunnelEvent_trackedLinkId_ts_idx" ON "FunnelEvent"("trackedLinkId", "ts");

-- CreateIndex
CREATE INDEX "FunnelEvent_attributedPostId_type_idx" ON "FunnelEvent"("attributedPostId", "type");

-- CreateIndex
CREATE INDEX "FunnelEvent_ts_type_idx" ON "FunnelEvent"("ts", "type");

-- CreateIndex
CREATE INDEX "FunnelEvent_sessionHash_idx" ON "FunnelEvent"("sessionHash");

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_externalId_key" ON "Conversion"("externalId");

-- CreateIndex
CREATE INDEX "Conversion_creatorId_occurredAt_idx" ON "Conversion"("creatorId", "occurredAt");

-- CreateIndex
CREATE INDEX "Conversion_trackedLinkId_occurredAt_idx" ON "Conversion"("trackedLinkId", "occurredAt");

-- CreateIndex
CREATE INDEX "Conversion_occurredAt_type_idx" ON "Conversion"("occurredAt", "type");

-- CreateIndex
CREATE INDEX "FollowerSnapshot_creatorId_ts_idx" ON "FollowerSnapshot"("creatorId", "ts");

-- CreateIndex
CREATE INDEX "Report_scope_scopeId_periodStart_idx" ON "Report"("scope", "scopeId", "periodStart");

-- CreateIndex
CREATE INDEX "Report_generatedAt_idx" ON "Report"("generatedAt");

-- CreateIndex
CREATE INDEX "AuditLog_ts_idx" ON "AuditLog"("ts");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_ts_idx" ON "AuditLog"("actorId", "ts");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ScraperJob_type_startedAt_idx" ON "ScraperJob"("type", "startedAt");

-- CreateIndex
CREATE INDEX "ScraperJob_status_idx" ON "ScraperJob"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ScraperConfig_type_key" ON "ScraperConfig"("type");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "_CreatorPosters_B_index" ON "_CreatorPosters"("B");

-- AddForeignKey
ALTER TABLE "RedditAccount" ADD CONSTRAINT "RedditAccount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedditAccount" ADD CONSTRAINT "RedditAccount_assignedPosterId_fkey" FOREIGN KEY ("assignedPosterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedditAccount" ADD CONSTRAINT "RedditAccount_assignedCreatorId_fkey" FOREIGN KEY ("assignedCreatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedditAccount" ADD CONSTRAINT "RedditAccount_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCreationAttempt" ADD CONSTRAINT "AccountCreationAttempt_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCreationAttempt" ADD CONSTRAINT "AccountCreationAttempt_redditAccountId_fkey" FOREIGN KEY ("redditAccountId") REFERENCES "RedditAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCreationAttempt" ADD CONSTRAINT "AccountCreationAttempt_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmingSession" ADD CONSTRAINT "FarmingSession_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmingSession" ADD CONSTRAINT "FarmingSession_redditAccountId_fkey" FOREIGN KEY ("redditAccountId") REFERENCES "RedditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountHealthSnapshot" ADD CONSTRAINT "AccountHealthSnapshot_redditAccountId_fkey" FOREIGN KEY ("redditAccountId") REFERENCES "RedditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAssignment" ADD CONSTRAINT "AccountAssignment_redditAccountId_fkey" FOREIGN KEY ("redditAccountId") REFERENCES "RedditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAssignment" ADD CONSTRAINT "AccountAssignment_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAssignment" ADD CONSTRAINT "AccountAssignment_posterId_fkey" FOREIGN KEY ("posterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_redditAccountId_fkey" FOREIGN KEY ("redditAccountId") REFERENCES "RedditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_subredditId_fkey" FOREIGN KEY ("subredditId") REFERENCES "Subreddit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_posterId_fkey" FOREIGN KEY ("posterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetric" ADD CONSTRAINT "PostMetric_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_redditAccountId_fkey" FOREIGN KEY ("redditAccountId") REFERENCES "RedditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_trackedLinkId_fkey" FOREIGN KEY ("trackedLinkId") REFERENCES "TrackedLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_attributedPostId_fkey" FOREIGN KEY ("attributedPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_trackedLinkId_fkey" FOREIGN KEY ("trackedLinkId") REFERENCES "TrackedLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowerSnapshot" ADD CONSTRAINT "FollowerSnapshot_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CreatorPosters" ADD CONSTRAINT "_CreatorPosters_A_fkey" FOREIGN KEY ("A") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CreatorPosters" ADD CONSTRAINT "_CreatorPosters_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
