// Guard: Java enum constants must keep acronyms uppercase for every
// --acronym-style setting.
//
// Java enum constants are rendered in UPPER_UNDERSCORE style. Before the fix
// in https://github.com/glideapps/quicktype/pull/2851 (issue #2850), the
// acronym-style option was still applied to words recognized as acronyms
// (e.g. "SPA"), so with --acronym-style=camel the JSON enum value
// "MULTI_SPA_IN_GROUP_REJECTED" produced the constant
// "MULTI_Spa_IN_GROUP_REJECTED" (and "MULTI_spa_IN_GROUP_REJECTED" with
// lowerCase).
//
// The regular fixture harness cannot catch this: the mangled constants are
// self-consistent identifiers, so the generated code still compiles, and
// (de)serialization uses the raw JSON names, so round-tripping succeeds.
// This check instead generates Java code directly and asserts on the emitted
// *identifier*. Note that we must NOT just check that the output contains
// "MULTI_SPA_IN_GROUP_REJECTED" — the raw JSON name always appears in the
// string literals of toValue()/forValue(), even when the identifier is
// mangled. We extract the identifier from `case <ident>: return "<name>";`
// and compare that.

import { InputData, JSONSchemaInput, quicktype } from "quicktype-core";

// "spa" is a known acronym (see Acronyms.const.ts), so acronym styling would
// apply to the SPA word if the fix regressed.
const enumValue = "MULTI_SPA_IN_GROUP_REJECTED";

const schema = JSON.stringify({
    $schema: "http://json-schema.org/draft-06/schema#",
    type: "object",
    properties: {
        messageCode: {
            type: "string",
            enum: [enumValue],
        },
    },
    required: ["messageCode"],
});

const acronymStyles = ["original", "pascal", "camel", "lowerCase"];

async function javaEnumConstantIdentifier(
    acronymStyle: string,
): Promise<string> {
    const schemaInput = new JSONSchemaInput(undefined);
    await schemaInput.addSource({ name: "TopLevel", schema });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({
        inputData,
        lang: "java",
        rendererOptions: { "acronym-style": acronymStyle },
    });
    const output = result.lines.join("\n");

    // Matches e.g. `case MULTI_SPA_IN_GROUP_REJECTED: return "MULTI_SPA_IN_GROUP_REJECTED";`
    // in the generated MessageCode.toValue() — the capture is the identifier.
    const match = output.match(
        new RegExp(`case (\\w+): return "${enumValue}";`),
    );
    if (match === null) {
        console.error(
            `error: could not find the enum constant for "${enumValue}" in the generated Java code (acronym-style=${acronymStyle}):\n\n${output}`,
        );
        process.exit(1);
    }

    return match[1];
}

export async function checkJavaEnumAcronymCasing(): Promise<void> {
    const failures: string[] = [];
    for (const style of acronymStyles) {
        const identifier = await javaEnumConstantIdentifier(style);
        if (identifier !== enumValue) {
            failures.push(
                `    acronym-style=${style}: got "${identifier}", expected "${enumValue}"`,
            );
        }
    }

    if (failures.length > 0) {
        console.error(
            `error: Java enum constants must keep acronyms uppercase for every acronym-style (issue #2850):

${failures.join("\n")}

javaNameStyle must force allUpperWordStyle for acronyms in UPPER_UNDERSCORE
names — see packages/quicktype-core/src/language/Java/utils.ts and
https://github.com/glideapps/quicktype/pull/2851`,
        );
        process.exit(1);
    }
}

// Allow running the check standalone:
//   NODE_PATH=`pwd`/node_modules npx ts-node --project test/tsconfig.json test/check-java-acronym-names.ts
if (require.main === module) {
    checkJavaEnumAcronymCasing().then(() => {
        console.error(
            "* Java enum constants keep acronyms uppercase for every acronym-style",
        );
    });
}
