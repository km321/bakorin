---
title: Data and relations
description: The generated REST API for every entity, with filters, sorting, pagination, and expand.
---

Every entity in `app.yaml` gets a REST resource under `/api/v1/<entity>`. Policies decide who can call each route.

| Method | Path | Action |
|---|---|---|
| GET | `/api/v1/<entity>` | List |
| GET | `/api/v1/<entity>/:id` | Get one |
| POST | `/api/v1/<entity>` | Create |
| PATCH | `/api/v1/<entity>/:id` | Update |
| DELETE | `/api/v1/<entity>/:id` | Delete |

Responses wrap results in `data`. Errors look like `{ "error": { "code": "...", "message": "..." } }`. A duplicate value on a `unique` field answers 409 `conflict`, and so does deleting a record that `restrict` relations still point at.

## Listing

```http
GET /api/v1/leads?filter[status]=new&sort=-createdAt&limit=20&offset=0
```

```json
{
  "data": [{ "id": "...", "company": "Northwind Studio", "status": "new" }],
  "meta": { "total": 1, "limit": 20, "offset": 0 }
}
```

- `limit` defaults to 50 and is capped at 100.
- `offset` defaults to 0.
- `sort` is a comma separated list of fields. Prefix with `-` for descending. The default is `-createdAt`.

## Filters

`filter[field]=value` is an equality match. Add an operator with `filter[field][op]=value`:

| Operator | Meaning |
|---|---|
| `eq` | Equal (default) |
| `neq` | Not equal |
| `gt`, `gte`, `lt`, `lte` | Comparisons |
| `like` | Contains, ignoring case. `%` and `_` in the value are matched literally. Same on SQLite and Postgres |
| `in` | Comma separated list |
| `isnull` | Null check |
| `has` | Many to many only: linked to any of a comma separated list of ids (up to 100) |

```http
GET /api/v1/tasks?filter[done]=false&filter[dueOn][lte]=2026-12-01
GET /api/v1/leads?filter[status][in]=new,qualified
```

Unknown fields, secret fields, and unknown operators are ignored.

## Expanding relations

Pass relation field names in `expand` to include the related rows under `$expand`:

```http
GET /api/v1/tasks?expand=leadId,ownerId
```

```json
{
  "data": [
    {
      "id": "...",
      "title": "Send proposal",
      "leadId": "...",
      "$expand": {
        "leadId": { "id": "...", "company": "Northwind Studio" },
        "ownerId": { "id": "...", "name": "Ada West" }
      }
    }
  ]
}
```

Expansion respects the related entity's `read` policy. If the caller cannot read the related row, its value is `null`. Secret fields on the related entity are removed.

`expand` works on the get route too: `GET /api/v1/tasks/:id?expand=leadId`.

## Many to many

Add `many: true` to a relation to link a record to any number of records:

```yaml
entities:
  projects:
    fields:
      name: { type: text, required: true }
      tagIds: { type: relation, to: tags, many: true }
```

- **Reads and writes use arrays of ids:** `{ "tagIds": ["...", "..."] }`. Order is kept, duplicates are dropped, and a field holds up to 1,000 links. `null` clears it. `required: true` means at least one link.
- **Expand** returns an array: `?expand=tagIds` gives `$expand.tagIds` as the linked records, in order, leaving out any the caller cannot read.
- **Filter** with `has`: `?filter[tagIds]=<id>` or `?filter[tagIds][has]=<id1>,<id2>` matches records linked to any of them.
- **Permissions.** Every linked id must exist and be readable by the caller under the target's `read` policy, or the write gets 400. On reads, links to records the caller cannot read are left out. A PATCH from someone who cannot see some links keeps those links.
- **Deletes.** Deleting either side removes the links. Linked records themselves are never deleted, so `onDelete` does not apply to many fields.
- **Storage.** Links live in a hidden join table (`_bakorin_link_<entity>_<field>`) with foreign keys on both sides, created and renamed by migrations on SQLite and Postgres and included in backups.
- **Realtime** events include the field only when the linked entity is publicly readable. Otherwise refetch the record to see its links.
- Many fields cannot be `unique`, indexed, sorted on, or given a `default`. Switching a field between one and many is refused by `bakorin migrate`: add a new field instead.

## Relation checks

When a client sets a relation field, the target record must exist and the caller must be able to read it under the target entity's `read` policy. Otherwise the write gets 400 with the same message either way, so record ids cannot be probed. Values set by a `before*` hook, and ownership fields stamped from the session, are not checked.

## Delete behavior

`onDelete` on a relation decides what happens to child rows when the parent is deleted:

- `restrict` (default): the delete fails while children point at the parent.
- `cascade`: children are deleted with the parent.
- `set_null`: the relation field on children is cleared.

## Generated types

`bakorin typegen` writes `bakorin.gen.ts` with an interface per entity. Pass the type to the SDK for typed `entity()` calls:

```bash
bakorin typegen -o ../web/src/bakorin.gen.ts
```

## OpenAPI

The live OpenAPI 3 document is at `GET /api/v1/openapi.json`. Swagger UI is bundled (no CDN) at `/docs` and `/api/v1/docs`. Try it out uses the admin session token when you are signed in, or a pasted bearer token. In production the spec is admin only by default, so sign in to the admin in the same browser first. Set `runtime.apiDocs: public` (or `BAKORIN_API_DOCS=public`) to publish it. `bakorin dev` serves it to everyone.
