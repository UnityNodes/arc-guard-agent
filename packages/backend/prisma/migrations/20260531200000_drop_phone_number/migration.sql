-- Drop the unused Twilio phone number column.
-- The voice-call feature was wired in schema and routes but never had a
-- consumer (no Twilio SDK, no provider). Removed from product surface.
ALTER TABLE "User" DROP COLUMN IF EXISTS "phoneNumber";
