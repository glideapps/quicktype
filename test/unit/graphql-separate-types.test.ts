import fs from "node:fs";

import { describe, expect, test } from "vitest";

import { GraphQLInput } from "quicktype-graphql-input";
import { InputData, quicktype } from "quicktype-core";

const schema = JSON.parse(
    fs.readFileSync("test/inputs/graphql/separate-types.gqlschema", "utf8"),
);
const query = fs.readFileSync(
    "test/inputs/graphql/separate-types1.graphql",
    "utf8",
);

async function renderTypeScript(combineClasses: boolean): Promise<string> {
    const input = new GraphQLInput();
    await input.addSource({ name: "SeparateTypes1", schema, query });

    const inputData = new InputData();
    inputData.addInput(input);

    const result = await quicktype({
        inputData,
        lang: "typescript",
        combineClasses,
        rendererOptions: { "just-types": true },
    });
    return result.lines.join("\n");
}

describe("GraphQL object types", () => {
    test.each([
        false,
        true,
    ])("keeps structurally identical schema types separate when combineClasses=%s", async (combineClasses) => {
        const output = await renderTypeScript(combineClasses);

        expect(output).toContain("export interface Config {");
        expect(output).toContain("export interface Props {");
        expect(output).toMatch(/config: Config \| null;/);
        expect(output).toMatch(/props:\s+Props \| null;/);
        expect(output.match(/export interface Item \{/g)).toHaveLength(1);
    });
});
