---
title: Permissions
description: Per action policies on every entity, plus field write locks and ownership rules.
---

Each entity can declare a policy for `read`, `create`, `update`, and `delete`. A policy is one expression or a list. A list is an OR: any match allows the action.

```yaml
leads:
  policies:
    read: [owner(ownerId), admin]
    create: authenticated
    update: owner(ownerId)
    delete: owner(ownerId)
```

## Expressions

| Expression | Allows |
|---|---|
| `public` | Anyone, including signed out callers |
| `authenticated` | Any signed in user |
| `admin` | Users whose role equals `auth.adminRole` |
| `owner(field)` | Rows where `field` equals the caller's user id |
| `role(name)` | Users with that role |

Admins bypass row filters so the admin UI can see every row.

## Defaults

If you leave out `policies`, Bakorin uses:

| Entity | read | create | update | delete |
|---|---|---|---|---|
| Auth entity | `[owner(id), admin]` | `admin` | `owner(id)` | `admin` |
| Any other entity | `authenticated` | `authenticated` | `authenticated` | `authenticated` |

Public signup belongs on `POST /api/v1/auth/signup` with `auth.signup: open`, not on `users.create`. Do not make the auth entity's `create` policy public. See [Auth](/docs/auth/#who-can-sign-up).

## Private fields on users

On the auth entity, the identity field (usually `email`), the role field, and `emailVerified` are private by default. A private field is returned only to the user it belongs to and to admins. Everyone else gets the row without it, even when a `read` policy lets them see the row. Filters and sorts on a private field are ignored for non admins, and rows pulled in with `expand` follow the same rule.

Mark any other field `private: true` to get the same treatment, or set `private: false` on one of the auth fields to opt out.

## Ownership

`owner(field)` does more than filter reads:

- On create and update, ownership fields are stamped from the session.
- A non admin who sends `ownerId` (or another ownership field) in the body gets **403**. Leaving it out still stamps the session user.
- Rows owned by someone else return **404** to a non admin, so their existence is not revealed.

## Field write locks

Policies decide who can touch a row. Write locks decide who can set a field:

```yaml
role: { type: enum, values: [user, admin], default: user, writable: admin }
slug: { type: text, readonly: true }
```

- `writable: admin` or `adminOnly: true`: only admins can set it.
- `writable: none` or `readonly: true`: nobody can set it through the CRUD API. Use [hooks](/docs/hooks/) to fill it.

The auth `role` field is always admin writable. Password updates through CRUD require an admin, or the current password for self service, and are always hashed.
