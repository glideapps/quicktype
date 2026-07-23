import { transformSync } from "esbuild";
import { describe, expect, test } from "vitest";

import {
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "quicktype-core";

async function render(sample: unknown, justTypes: boolean): Promise<string> {
    const jsonInput = jsonInputForTargetLanguage("typescript");
    await jsonInput.addSource({
        name: "Welcome",
        samples: [JSON.stringify(sample)],
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);
    const result = await quicktype({
        inputData,
        lang: "typescript",
        rendererOptions: { "just-types": justTypes },
    });
    return result.lines.join("\n");
}

interface GeneratedConvert {
    toWelcome: (json: string) => unknown;
    welcomeToJson: (value: unknown) => string;
}

function executeGeneratedTypeScript(source: string): GeneratedConvert {
    const javascript = transformSync(source, {
        format: "cjs",
        loader: "ts",
        target: "node20",
    }).code;
    const generatedModule: { exports: { Convert?: GeneratedConvert } } = {
        exports: {},
    };
    const loadModule = new Function("exports", "module", javascript);
    loadModule(generatedModule.exports, generatedModule);

    const { Convert } = generatedModule.exports;
    if (Convert === undefined)
        throw new Error("Generated Convert was not exported");
    return Convert;
}

describe.each([
    true,
    false,
])("TypeScript empty objects (just-types=%s)", (justTypes) => {
    test("uses object instead of an empty interface", async () => {
        const output = await render(
            {
                labels: { accountNumber: "Accountnumber" },
                hints: {},
            },
            justTypes,
        );

        expect(output).toMatch(/hints:\s+object;/);
        expect(output).not.toContain("interface Hints");
    });
});

test("keeps a type export for a top-level empty object", async () => {
    const output = await render({}, true);

    expect(output).toContain("export type Welcome = object;");
});

describe("TypeScript empty-object runtime conversion", () => {
    test("accepts and round-trips properties nested in a collapsed object", async () => {
        const source = await render(
            {
                labels: { accountNumber: "Accountnumber" },
                hints: {},
            },
            false,
        );
        const convert = executeGeneratedTypeScript(source);
        const input = {
            labels: { accountNumber: "Accountnumber" },
            hints: { foo: "bar", count: 2 },
        };

        const value = convert.toWelcome(JSON.stringify(input));
        expect(value).toEqual(input);
        expect(JSON.parse(convert.welcomeToJson(value))).toEqual(input);
    });

    test("accepts and round-trips properties in a top-level collapsed object", async () => {
        const source = await render({}, false);
        const convert = executeGeneratedTypeScript(source);
        const input = { foo: "bar", count: 2 };

        const value = convert.toWelcome(JSON.stringify(input));
        expect(value).toEqual(input);
        expect(JSON.parse(convert.welcomeToJson(value))).toEqual(input);
    });
});
