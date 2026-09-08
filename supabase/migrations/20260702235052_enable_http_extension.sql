/*
# Enable HTTP Extension

1. Extensions
   - Enables the `http` extension in the `extensions` schema.
   - Required for making outbound HTTP requests from Postgres functions
     (used by the leaked password verification hook).

2. Important Notes
   - Idempotent: uses IF NOT EXISTS.
*/

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
