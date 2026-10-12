import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { TARGETS, renderSchema } from "../scripts/db-schema.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return null;
  }
}

describe("renderSchema()", () => {
  it("只替换 datasource 里的 provider", () => {
    const tpl = [
      "generator client {",
      '  provider = "prisma-client"',
      "}",
      "",
      "datasource db {",
      '  provider = "sqlite"',
      '  url      = env("DATABASE_URL")',
      "}",
    ].join("\n");

    const pg = renderSchema(tpl, "postgresql");
    assert.match(pg, /datasource db \{\s*provider = "postgresql"/);
    // generator 的 provider 不能被误伤 —— 这是最容易写错的地方
    assert.match(pg, /generator client \{\s*provider = "prisma-client"/);
  });

  it("缺少 datasource 或 provider 时明确报错，而不是静默产出坏 schema", () => {
    assert.throws(() => renderSchema("model A { id String @id }", "sqlite"), /datasource/);
    assert.throws(() => renderSchema("datasource db {\n url = env(\"X\")\n}", "sqlite"), /provider/);
  });
});

describe("schema 变体与模板保持同步", () => {
  it("提交进仓库的 prisma/schema.prisma 必须等于模板的 sqlite 渲染结果", async () => {
    const template = await readFile(path.join(ROOT, "prisma", "schema.template.prisma"), "utf8");
    const onDisk = await readIfExists(path.join(ROOT, TARGETS.sqlite));

    assert.ok(
      onDisk !== null,
      "prisma/schema.prisma 不存在。它必须提交进仓库 —— " +
        "否则 clone 下来的人跑不了 prisma generate。执行 `pnpm db:render` 生成。",
    );
    assert.equal(
      onDisk,
      renderSchema(template, "sqlite"),
      "prisma/schema.prisma 与模板不一致（改了模板但没重跑 `pnpm db:render`）。",
    );
  });
});
