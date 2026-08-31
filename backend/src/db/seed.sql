-- src/db/seed.sql
-- PURPOSE: Optional sample data so the local database isn't empty while you build
-- the frontend. Run AFTER schema.sql. Safe to skip in production.
-- INTENDED OUTPUT LINK: gives the Day 3 map something to display (a scholarship
-- and a country with a user) before real registration exists.

-- One demo admin. The hash below is a REAL bcrypt hash of the password 'demo1234'
-- (cost 12), so this account can actually log in. Change it before production.
INSERT INTO admins (email, password_hash)                 -- Insert a single admin row...
VALUES ('admin@example.com', '$2b$12$W344fDtHPXNxlb0FckQnKOchsqcO/UviH1wBH798kD2JADqhxn.LC'); -- password = 'demo1234' (Day 5 admin login).

-- One demo user located in Mexico so the map's right panel has a card to show.
INSERT INTO users (email, password_hash, first_name, last_name, current_country, current_city, status)
VALUES (
  'demo@example.com',            -- Demo login email.
  '$2b$12$W344fDtHPXNxlb0FckQnKOchsqcO/UviH1wBH798kD2JADqhxn.LC',    -- Real bcrypt hash; password = 'demo1234'.
  'Demo',                        -- first_name shown on the user card.
  'Estudiante',                  -- last_name shown on the user card.
  'Mexico',                      -- current_country: clicking Mexico on the map will surface this user (Day 3).
  'Guanajuato',                  -- current_city shown under the name.
  'studying'                     -- status badge value (must match the CHECK constraint).
);

-- One demo scholarship in Mexico so the map's left panel has an entry to render.
INSERT INTO scholarships (institution_name, country, category, areas, start_date, end_date, link, description, status, source)
VALUES (
  'Universidad Demo',                          -- Card title.
  'Mexico',                                    -- Must match a user's current_country / the map's country name for it to appear.
  'university',                                -- Places it under the "Universidad" section of the left panel.
  ARRAY['Ingeniería','Ciencias'],             -- areas array, rendered as a comma-joined list.
  '2026-01-01',                                -- Application start date.
  '2026-12-31',                                -- Application end date (in the future, so it stays 'active').
  'https://example.com/beca',                  -- External apply link.
  'Beca de demostración para pruebas locales.',-- Description text.
  'active',                                    -- Visible in the read query (status='active').
  'manual'                                     -- Marked manual so the Day 4 API import never overwrites this demo row.
);
