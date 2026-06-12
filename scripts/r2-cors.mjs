// Set (or show) the R2 bucket CORS policy. Presigned browser uploads PUT
// straight to the bucket from the app origin, and R2 buckets ship with no
// CORS policy at all, so without this every upload dies in preflight.
// Rerun whenever an allowed origin changes (e.g. the custom-domain move).
//
//   node scripts/r2-cors.mjs          # apply the policy below, then show it
//   node scripts/r2-cors.mjs --show   # just show the current policy
//
// Loads .env.local for the R2_* vars (BOM/CRLF-safe, PowerShell-written files).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";

for (const line of readFileSync(".env.local", "utf8")
  .replace(/^﻿/, "")
  .split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const {
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_ENDPOINT,
  NEXT_PUBLIC_APP_URL,
} = process.env;
if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_ENDPOINT) {
  console.error("R2_* vars missing; see runbook.md §1.");
  process.exit(1);
}

// Only PUT needs CORS: presigned uploads. Image GETs go through the public
// base URL as plain <img> requests, which never preflight.
const origins = [
  NEXT_PUBLIC_APP_URL || "https://ledgr-teal.vercel.app",
  "http://localhost:3000",
];

const corsXml = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
${origins.map((o) => `    <AllowedOrigin>${o}</AllowedOrigin>`).join("\n")}
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedHeader>content-type</AllowedHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;

const client = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});
const corsUrl = `${R2_ENDPOINT.replace(/\/+$/, "")}/${R2_BUCKET}?cors`;

async function show() {
  const res = await fetch(await client.sign(new Request(corsUrl)));
  const body = await res.text();
  if (res.status === 404) {
    console.log("No CORS policy is set on the bucket.");
  } else {
    console.log(`GET ?cors -> ${res.status}\n${body}`);
  }
  return res.status;
}

if (process.argv.includes("--show")) {
  await show();
  process.exit(0);
}

const put = await fetch(
  await client.sign(
    new Request(corsUrl, {
      method: "PUT",
      body: corsXml,
      headers: {
        "Content-Type": "application/xml",
        // S3 PutBucketCors requires Content-MD5.
        "Content-MD5": createHash("md5").update(corsXml).digest("base64"),
      },
    })
  )
);
if (!put.ok) {
  console.error(`PUT ?cors failed: ${put.status}\n${await put.text()}`);
  process.exit(1);
}
console.log(`CORS policy applied for: ${origins.join(", ")}`);
await show();
