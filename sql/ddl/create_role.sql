CREATE ROLE anagram_reviewer_app WITH LOGIN ENCRYPTED PASSWORD 'xxxxxx';

GRANT
SELECT
, UPDATE
, INSERT
ON ALL TABLES IN SCHEMA public TO anagram_reviewer_app;

GRANT
SELECT
, UPDATE
ON ALL SEQUENCES IN SCHEMA public TO anagram_reviewer_app;
