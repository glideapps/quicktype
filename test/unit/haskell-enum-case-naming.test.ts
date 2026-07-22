import {
    InputData,
    JSONSchemaInput,
    quicktype,
} from "../../packages/quicktype-core/src/index.js";
import { describe, expect, test } from "vitest";

async function renderHaskell(schema: object): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({
        name: "TopLevel",
        schema: JSON.stringify(schema),
    });

    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "haskell",
    });
    return result.lines.join("\n");
}

function enumConstructors(output: string): string[] {
    // Collect the constructors of the generated `data Health` declaration,
    // which are emitted one per line as `= OkHealth` / `| ErrorHealth`.
    const lines = output.split("\n");
    const start = lines.findIndex((line) => line.startsWith("data Health"));
    if (start < 0) {
        return [];
    }

    const constructors: string[] = [];
    for (const line of lines.slice(start + 1)) {
        const match = line.match(/^\s*[=|]\s+(\S+)/);
        if (match === null) {
            break;
        }

        constructors.push(match[1]);
    }

    return constructors;
}

describe("Haskell enum case naming", () => {
    // Enum cases are emitted as `<case><enumName>` so the enum name already
    // disambiguates each constructor.  When a case name would otherwise be
    // renamed to avoid a forbidden identifier (here `error`), the renderer
    // must not compound the enum-name suffix on top of that rename.  A
    // round-trip fixture cannot catch this: the constructor name is invisible
    // to JSON serialization, so both the correct and the over-renamed output
    // round-trip identically.  See issue #2868.
    test("suffixes the enum name without over-renaming forbidden cases", async () => {
        const schema = {
            type: "object",
            properties: {
                health: {
                    type: "string",
                    enum: ["ok", "error"],
                },
            },
            required: ["health"],
        };

        const output = await renderHaskell(schema);
        const constructors = enumConstructors(output);

        expect(constructors).toEqual(["OkHealth", "ErrorHealth"]);
        // Guard against the specific regression: the "error" case being
        // renamed to "HealthError" before the enum suffix is appended.
        expect(output).not.toContain("HealthErrorHealth");
    });
});
