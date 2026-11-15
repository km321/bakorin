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

Responses wrap results in `data`. Errors look like `{ "error": { "code": "...", "message": "..." } }`.

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
| `like` | Contains (`%value%`) |
| `in` | Comma separated list |
| `isnull` | Null check |

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

The live OpenAPI 3 document is at `GET /api/v1/openapi.json`. Swagger UI is bundled (no CDN) at `/docs` and `/api/v1/docs`. Try it out uses the admin session token when you are signed in, or a pasted bearer token.
