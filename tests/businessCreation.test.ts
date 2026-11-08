// Only the platform operator may create businesses. These checks fail if a
// public signup endpoint is reintroduced, or if an operator route stops
// checking for a platform admin.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

const api = path.resolve(__dirname, "../src/app/api");

test("there is no public signup API", () => {
  assert.equal(fs.existsSync(path.join(api, "auth/signup/route.ts")), false);
});

test("nothing outside the platform console creates a Business", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts" && /Business\.create\(|new Business\(/.test(fs.readFileSync(p, "utf8"))) {
        offenders.push(path.relative(api, p));
      }
    }
  };
  walk(api);
  assert.deepEqual(offenders, ["platform/businesses/route.ts"]);
});

test("every platform route requires a platform admin on every handler", () => {
  const dir = path.join(api, "platform");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") files.push(p);
    }
  };
  walk(dir);
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const handlers = (src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) ?? []).length;
    const checks = (src.match(/await requirePlatformAdmin\(req\)/g) ?? []).length;
    assert.ok(handlers > 0 && checks >= handlers, `${path.relative(api, f)}: ${handlers} handlers, ${checks} admin checks`);
  }
});
