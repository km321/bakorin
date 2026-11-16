---
title: Schema changes
description: How Bakorin applies app.yaml changes, what needs confirmation, renames with renameFrom, and automatic backups.
---

When `app.yaml` changes, Bakorin compares it with the schema stored in the database and sorts every difference into one of four groups.

| Group | Examples | What happens |
|---|---|---|
| Additive | add an entity, an optional or defaulted field, an index, an enum value | Applied on start or reload |
| Renames | `renameFrom` on a field or an entity | Backup first, then applied on start or reload. Data is kept |
| Removals | remove a field, an entity, or enum values | Refused until you confirm. Backup first |
| Blocked | change a field's type, make a field required without a default, add `unique` to an existing field, point a relation at another entity | Refused. Change `app.yaml` instead |

## See the plan

```bash
bakorin migrate --plan
```

```text
Migration plan for studio-crm (sqlite)

Additive, applied automatically:
  - add field leads.mobile (text)
Renames declared with renameFrom, applied automatically after a backup:
  - rename field leads.company to leads.organization
  - rename entity notes to comments
Removals, need confirmation:
  - remove enum values lost from leads.stage (existing rows keep them)
  - remove field leads.phone (the column stays in the database but the API stops serving it)
    hint: if leads.mobile is phone renamed, add renameFrom: phone to it instead

Confirm code: c1fc8e27
Apply with: bakorin migrate --allow-destructive c1fc8e27
A backup is taken automatically before anything is changed.
```

`--plan` only reads. It never changes the database.

## Removals need confirmation

If `app.yaml` removes something, the server refuses to start (and `bakorin dev` keeps the previous schema) with a message like this:

```text
app.yaml removes things that exist in the database, so Bakorin did not apply it:
- remove field leads.phone (the column stays in the database but the API stops serving it)

Nothing was changed. To see the full plan run: bakorin migrate --plan
To apply it on purpose run: bakorin migrate --allow-destructive c1fc8e27
or start the server once with BAKORIN_ALLOW_DESTRUCTIVE=c1fc8e27
```

Confirm in one of two ways:

- **CLI:** `bakorin migrate --allow-destructive <code>`, then start the server as usual.
- **Environment:** set `BAKORIN_ALLOW_DESTRUCTIVE=<code>` for one deploy, for example on Railway, then remove it.

The code names exactly the removals in the plan. If `app.yaml` changes again, the old code stops working, so a confirmation cannot approve a different change by accident. `bakorin migrate` exits with code 2 when it stops for a confirmation, and 1 when a change is blocked.

Removals are soft. The column or table stays in the database with its data, and Bakorin stops serving it. Removed enum values stay in existing rows; new writes must use the remaining values. To bring a removed field back, add it again with the same name and type.

## Renames keep data

Without `renameFrom`, renaming looks like "remove the old one, add a new one", which needs confirmation and leaves the data behind in the old column. Declare the rename instead:

```yaml
entities:
  comments:
    renameFrom: notes          # the table is renamed, rows are kept
    fields:
      body: { type: text, required: true }
  leads:
    fields:
      organization: { type: text, renameFrom: company }   # the column is renamed
```

Renames run on start, after an automatic backup. Leaving `renameFrom` in `app.yaml` afterwards is harmless. When a plan removes a field and adds another in the same entity, it suggests `renameFrom`.

## Automatic backups

Before any rename or removal, Bakorin takes a full backup to your normal backup destination, with reason `pre-migration` in its manifest. Additive changes do not take a backup. To undo a change, restore that backup with [`bakorin restore`](/docs/backups/#restore).

## Blocked changes

Bakorin does not change a column's type in place, because narrowing (for example text to integer) can fail halfway or lose data. Do it in steps instead:

1. Add a new field with the new type.
2. Copy and convert the data with a hook, a script, or the API.
3. Remove the old field (with confirmation).

The same goes for making a field required: give it a `default`, or fill every row first.

## Several servers

Each migration runs in one transaction with a lock (a transaction scoped advisory lock on Postgres, `begin immediate` on SQLite), so only one instance applies a change and the plan is checked again inside the lock. If any statement fails, every change in the plan and the stored schema roll back together, on both databases.
