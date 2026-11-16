import { createServer } from "node:http";
// Fictional webhook receiver for the demo: answers 200 to everything.
createServer((_req, res) => res.end("ok")).listen(4599, "127.0.0.1");
