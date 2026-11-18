# MySQL and MariaDB

Bakorin supports MySQL 8.0.13+ and MariaDB 10.11+/11.x through Kysely's `MysqlDialect` and the `mysql2` driver. Both use `runtime.dialect: mysql`. `mariadb` is also accepted as a dialect alias.

## Connect

```yaml
runtime:
  dialect: mysql
  mysql:
    url: ${DATABASE_URL}
```

Set `DATABASE_URL` to your provider's `mysql://USER:PASSWORD@HOST:3306/DATABASE` or `mariadb://USER:PASSWORD@HOST:3306/DATABASE` URL. Percent encode special characters in the username and password. Keep it in your secret environment variables, never in git. The server connects to an existing database. Give the user permission to create and alter tables and indexes, read and write rows, and use `GET_LOCK`.

With no explicit dialect or database block, a `mysql://` or `mariadb://` `DATABASE_URL` is detected automatically. An explicit SQLite configuration wins, so scaffolded apps that say `dialect: sqlite` need the YAML change above. You can omit `dialect` when a `mysql.url` or `mariadb.url` block is set: its URL selects the driver.

For TLS, add the URL parameter `ssl` as percent encoded JSON, for example `?ssl=%7B%22rejectUnauthorized%22%3Atrue%7D`. It uses the system certificate authorities. Do not disable certificate verification on the public internet. `connectionLimit` is also accepted (default 8). Other driver settings are controlled by Bakorin for consistent behavior.

## Supported features

Auth and refresh token rotation, all field types, JSON values, sanitized richtext, files, single and many to many relations, hidden join tables, Stripe starter tables, cron and jobs, mail and webhook outboxes, audit logs, schema sync, portable export/import and backup restore use the same API as SQLite and Postgres.

Writes do not use `RETURNING`. Bakorin generates ids before the insert and reads the row back, so it does not depend on MariaDB's partial `RETURNING` support. Upserts use `ON DUPLICATE KEY UPDATE`.

Tables use InnoDB, `utf8mb4` and the case sensitive `utf8mb4_bin` collation. This supports emoji and keeps equality and unique checks case sensitive, like SQLite and Postgres. `like` filters remain case insensitive and treat `%` and `_` as literal search characters. SQL identifiers keep their configured case. Use the same table name casing across hosts, particularly when moving between Linux and Windows.

Bakorin sets each connection to strict SQL mode, `ANSI_QUOTES`, UTC and `READ COMMITTED` isolation. This keeps raw SQL identifiers portable, rejects truncation, and lets concurrent refresh token requests see the same successor. If hooks run raw SQL, use Kysely's query builders and parameter binding. Double quotes mean identifiers, not string literals.

## Storage details

- Ids, single relation ids, unique text, email and enum values use `varchar(255)`. Unique text values cannot exceed 255 characters. Too long values are rejected, never silently cut.
- Other text and richtext use `longtext`. Plain indexes on long text use a 191 character prefix, which helps search but does not restrict the stored value. Unique indexes always cover the entire value. Composite indexes must fit InnoDB's 3072 byte key limit.
- JSON uses MySQL's native `JSON` type or MariaDB's validated JSON alias. Objects, arrays, strings, numbers, booleans and null round trip through the API. JSON fields are not sortable or indexable, the same as on the other databases.
- Booleans are stored as 0/1 and returned as true/false. Numbers use `double`, integers use `integer` and system epoch milliseconds use `bigint`.
- Dates use `date`. Datetimes and system timestamps are UTC ISO 8601 text with milliseconds (`2026-11-18T21:30:00.000Z`), the same as SQLite, so they never depend on a server time zone. Bakorin fills `createdAt` and `updatedAt` on writes. TEXT and JSON defaults use parenthesized expressions, which requires MySQL 8.0.13+.
- Single relations and join tables have real foreign keys. Join tables are hidden from the public API and admin navigation. Deleting either side removes the links.

## Schema changes and backups

Schema sync is serialized with a session `GET_LOCK`. MySQL and MariaDB implicitly commit DDL, so a failed schema change can leave some new tables or columns in place. The stored schema is only advanced after all statements succeed. Fix the cause and rerun the command: create and add operations check the catalog and are safe to retry. Avoid concurrent manual DDL. Unlike SQLite and Postgres, DDL changes cannot roll back as one transaction.

Use portable `bakorin export`, `import` and scheduled backups. Exports read one InnoDB repeatable read snapshot, and imports are transactional. SQLite snapshot commands do not apply. Keep the database and uploaded file backups together.

Realtime works with the single process memory broker. The Postgres `LISTEN/NOTIFY` broker is Postgres only: MySQL and MariaDB do not yet offer cross instance realtime fan out. Run one API instance for realtime subscriptions.

## Test locally

```bash
# Use a disposable server and an account that can create and drop databases.
export MYSQL_TEST_URL='mysql://USER:PASSWORD@127.0.0.1:3306/mysql'
bun run test:mysql

export MYSQL_TEST_URL='mariadb://USER:PASSWORD@127.0.0.1:3307/mysql'
bun run test:mariadb
```

Each database test makes and drops an isolated database. Never use a production database account for tests. CI covers MySQL 8.0 and MariaDB 10.11, with full unit tests and browser runs for starters, content, SaaS and Stripe templates.
