-- Wave 2.1: autonomous actions on Rule (additive, prod-safe)
-- Backfills default values so all existing rules continue to behave as price-triggered alerts.
ALTER TABLE "Rule" ADD COLUMN "action"       TEXT  NOT NULL DEFAULT 'ALERT';
ALTER TABLE "Rule" ADD COLUMN "triggerType"  TEXT  NOT NULL DEFAULT 'PRICE';
ALTER TABLE "Rule" ADD COLUMN "actionConfig" JSONB;

-- Index for worker: scan active rules by triggerType (balance-triggered rules are checked separately from price)
CREATE INDEX "Rule_isActive_triggerType_idx" ON "Rule"("isActive", "triggerType");
