CREATE TABLE app_user (
  id           SERIAL NOT NULL PRIMARY KEY,
  username     TEXT   NOT NULL UNIQUE,
  passwordHash TEXT   NOT NULL
);

CREATE ROLE anagram_reviewer_app WITH LOGIN ENCRYPTED PASSWORD 'xxxxxx';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anagram_reviewer_app;
GRANT UPDATE ON ALL TABLES IN SCHEMA public TO anagram_reviewer_app;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO anagram_reviewer_app;
GRANT UPDATE ON ALL SEQUENCES IN SCHEMA public TO anagram_reviewer_app;
