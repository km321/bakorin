export interface S3Mock {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  objects: Map<string, Uint8Array>;
  stop: () => void;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function startS3Mock(bucket = "bakorin"): S3Mock {
  const objects = new Map<string, Uint8Array>();
  const accessKey = "minioadmin";
  const secretKey = "minioadmin";

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const hostBucket = url.hostname.endsWith(".localhost") ? url.hostname.split(".")[0] : undefined;
      let path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      let key = path;
      if (!hostBucket) {
        if (path === bucket || path === "") {
          key = "";
        } else if (path.startsWith(`${bucket}/`)) {
          key = path.slice(bucket.length + 1);
        }
      }
      if (request.method === "PUT" && key === "") {
        return new Response(null, { status: 200 });
      }
      if (request.method === "HEAD") {
        if (!objects.has(key)) {
          return new Response(null, { status: 404 });
        }
        return new Response(null, {
          status: 200,
          headers: { "content-length": String(objects.get(key)?.byteLength ?? 0) },
        });
      }
      if (request.method === "GET" && (key === "" || url.searchParams.has("list-type") || url.searchParams.get("prefix") !== null)) {
        if (url.searchParams.has("location")) {
          return new Response(`<?xml version="1.0" encoding="UTF-8"?><LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></LocationConstraint>`);
        }
        const prefix = url.searchParams.get("prefix") ?? "";
        const maxKeys = Number(url.searchParams.get("max-keys") ?? 1000);
        const startAfter = url.searchParams.get("start-after") ?? "";
        const keys = [...objects.keys()]
          .filter((item) => item.startsWith(prefix))
          .sort()
          .filter((item) => item > startAfter)
          .slice(0, maxKeys);
        const contents = keys
          .map(
            (item) =>
              `<Contents><Key>${xmlEscape(item)}</Key><Size>${objects.get(item)?.byteLength ?? 0}</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified><ETag>&quot;etag&quot;</ETag></Contents>`,
          )
          .join("");
        const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${xmlEscape(prefix)}</Prefix><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>false</IsTruncated><KeyCount>${keys.length}</KeyCount>${contents}</ListBucketResult>`;
        return new Response(body, { headers: { "content-type": "application/xml" } });
      }
      if (request.method === "GET") {
        const bytes = objects.get(key);
        if (!bytes) {
          return new Response("not found", { status: 404 });
        }
        return new Response(bytes);
      }
      if (request.method === "PUT") {
        const bytes = new Uint8Array(await request.arrayBuffer());
        objects.set(key, bytes);
        return new Response(null, { status: 200, headers: { etag: '"etag"' } });
      }
      if (request.method === "DELETE") {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      return new Response("no", { status: 405 });
    },
  });

  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    bucket,
    accessKey,
    secretKey,
    objects,
    stop: () => server.stop(true),
  };
}
