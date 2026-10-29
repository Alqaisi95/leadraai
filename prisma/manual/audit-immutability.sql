-- R1.6: run once as superuser after migrations.
-- App connects as leadra_app which cannot alter history.
-- CREATE ROLE leadra_app LOGIN PASSWORD '...';
-- GRANT CONNECT ON DATABASE leadra TO leadra_app;
-- GRANT USAGE ON SCHEMA public TO leadra_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO leadra_app;
REVOKE UPDATE, DELETE ON audit_logs FROM leadra_app;
GRANT SELECT, INSERT ON audit_logs TO leadra_app;
