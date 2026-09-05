import { expect, test } from "vitest";

import {
    type Input,
    InputData,
    jsonInputForTargetLanguage,
    quicktype,
} from "quicktype-core";

test("does not merge structurally identical inferred classes when combineClasses is false", async () => {
    const jsonInput = jsonInputForTargetLanguage("cs");
    await jsonInput.addSource({
        name: "Trade",
        // Keep both values non-integral so their object shapes are identical.
        samples: [
            '{"amount":{"initialValue":1.5},"rate":{"initialValue":0.012}}',
        ],
    });

    const inputData = new InputData();
    inputData.addInput(jsonInput);

    const result = await quicktype({
        inputData,
        lang: "cs",
        combineClasses: false,
    });
    const output = result.lines.join("\n");

    expect(output).toContain("public partial class Amount");
    expect(output).toContain("public partial class Rate");
});

test("preserves the fixedTopLevels argument position for custom inputs", async () => {
    let receivedFixedTopLevels: boolean | undefined;
    const input: Input<unknown> = {
        kind: "custom",
        needIR: false,
        needSchemaProcessing: false,
        addSource: async () => {},
        addSourceSync: () => {},
        addTypes: async (
            _ctx,
            typeBuilder,
            _inferMaps,
            _inferEnums,
            fixedTopLevels,
        ) => {
            receivedFixedTopLevels = fixedTopLevels;
            typeBuilder.addTopLevel(
                "Value",
                typeBuilder.getPrimitiveType("integer"),
            );
        },
        addTypesSync: () => {},
        singleStringSchemaSource: () => undefined,
    };
    const inputData = new InputData();
    inputData.addInput(input);

    await quicktype({
        inputData,
        lang: "typescript",
        combineClasses: false,
        fixedTopLevels: true,
    });

    expect(receivedFixedTopLevels).toBe(true);
});
