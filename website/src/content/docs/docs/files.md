---
title: Files
description: Upload files to local disk or S3 compatible storage and serve them with short lived signed URLs.
---

Signed in users can upload files. Files are stored on local disk or in an S3 compatible bucket (Railway buckets, Cloudflare R2, MinIO), and downloads always use a short lived signed URL.

## Configure

```yaml
runtime:
  files:
    driver: local          # or s3
    path: ./data/uploads
    maxBytes: 10485760     # 10 MiB
    allowedMimeTypes: [image/png, image/jpeg, application/pdf, text/plain]
    signedUrlTtlSeconds: 900
```

Defaults: 10 MiB, PNG, JPEG, WebP, GIF, PDF, and plain text, and 15 minute signed URLs. Set `allowedMimeTypes: ["*"]` to allow any type.

Setting a bucket in the environment (`BUCKET` or `S3_BUCKET`) switches the driver to `s3`. See [Configuration](/docs/configuration/) for S3 variables. For Railway buckets set `S3_ADDRESSING_STYLE=path`.

## Upload

Send a multipart form with a `file` field:

```bash
curl -X POST http://127.0.0.1:4371/api/v1/files \
  -H "authorization: Bearer $ACCESS_TOKEN" \
  -F file=@brief.pdf
```

```json
{
  "data": {
    "id": "...",
    "key": "....pdf",
    "filename": "brief.pdf",
    "contentType": "application/pdf",
    "size": 48213,
    "url": "/api/v1/files/...?exp=...&sig=...",
    "expiresAt": 1763236800
  }
}
```

Uploads over `maxBytes` or with a type that is not allowed return 400. Signed out callers get 401. A PNG, JPEG, GIF, WebP, or PDF whose bytes do not match its declared type is refused with 400.

Downloads of images, PDF, and plain text open inline. Every other type, including HTML and SVG, downloads as an attachment with `Content-Security-Policy: sandbox`, so an uploaded page cannot run script on your API or admin origin even with `allowedMimeTypes: ["*"]`. All downloads send `X-Content-Type-Options: nosniff`.

## Attach to a record

Add a `file` field to an entity and store the file id in it:

```yaml
leads:
  fields:
    brief: { type: file, description: Optional brief or attachment. }
```

The admin UI shows a file picker for `file` fields and uploads for you.

## Download

`GET /api/v1/files/:id?exp=...&sig=...` serves the file only with a valid signature. Session cookies are not enough. To get a fresh link:

```http
POST /api/v1/files/:id/sign
```

Only the uploader or an admin can sign a file.
