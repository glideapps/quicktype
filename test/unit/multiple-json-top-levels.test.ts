import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";

const fixtureDirectory = "test/inputs/json/priority/issue-1630";
const fixtureFiles = [
    "AccountsGet.Request.json",
    "AuthGet.Request.json",
    "TransactionsGet.Request.json",
];

async function renderCSharp(): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("csharp");
    for (const filename of fixtureFiles) {
        await jsonInput.addSource({
            name: path.basename(filename, ".json"),
            samples: [
                fs.readFileSync(path.join(fixtureDirectory, filename), "utf8"),
            ],
        });
    }

    const inputData = new InputData();
    inputData.addInput(jsonInput);

    const result = await quicktype({
        inputData,
        lang: "csharp",
        rendererOptions: { framework: "SystemTextJson", namespace: "Plaid" },
    });
    return result.lines.join("\n");
}

describe("multiple named JSON top-levels", () => {
    test("keeps similar request types distinct", async () => {
        const output = await renderCSharp();

        expect(output).toMatch(
            /public partial class AccountsGetRequest\s*\{[\s\S]*?JsonPropertyName\("client_id"\)[\s\S]*?JsonPropertyName\("secret"\)[\s\S]*?JsonPropertyName\("access_token"\)/,
        );
        expect(output).toContain(
            "public static AccountsGetRequest FromJson(string json) => JsonSerializer.Deserialize<AccountsGetRequest>(json, Plaid.Converter.Settings);",
        );
        expect(output).toContain(
            "public AuthGetRequestOptions Options { get; set; }",
        );
        expect(output).toContain("public partial class AuthGetRequestOptions");
        expect(output).not.toContain("AccountsGetRequestOptions");
        expect(output).toContain(
            "public TransactionsGetRequestOptions Options { get; set; }",
        );
        expect(output).toContain(
            "public partial class TransactionsGetRequestOptions",
        );
    });
});
