import {
    FetchingJSONSchemaStore,
    InputData,
    type JSONSchema,
    JSONSchemaInput,
    type Type,
    TypeAttributeKind,
    quicktype,
} from "quicktype-core";
import { expect, test } from "vitest";

class DeprecatedTypeAttributeKind extends TypeAttributeKind<boolean> {
    public constructor() {
        super("deprecated");
    }

    public combine(attributes: boolean[]): boolean {
        return attributes.some((deprecated) => deprecated);
    }

    public makeInferred(): boolean {
        return false;
    }

    public addToSchema(
        schema: { [name: string]: unknown },
        _type: Type,
        deprecated: boolean,
    ): void {
        if (deprecated) schema.deprecated = true;
    }
}

const deprecatedTypeAttributeKind = new DeprecatedTypeAttributeKind();

function deprecatedAttributeProducer(schema: JSONSchema) {
    if (
        typeof schema !== "object" ||
        schema === null ||
        schema.deprecated !== true
    ) {
        return undefined;
    }

    return {
        forType: deprecatedTypeAttributeKind.makeAttributes(true),
    };
}

test("a forType custom attribute does not leak between primitive schema nodes (issue #1268)", async () => {
    const schemaInput = new JSONSchemaInput(new FetchingJSONSchemaStore(), [
        deprecatedAttributeProducer,
    ]);
    await schemaInput.addSource({
        name: "Player",
        schema: JSON.stringify({
            type: "object",
            properties: {
                externalId: { type: "string" },
                participant: { $ref: "#/definitions/Participant" },
            },
            required: ["externalId", "participant"],
            definitions: {
                Participant: {
                    type: "object",
                    properties: {
                        emailAddress: { type: "string", deprecated: true },
                        phoneNumber: { type: "string", deprecated: true },
                    },
                    required: ["emailAddress", "phoneNumber"],
                },
            },
        }),
    });
    const inputData = new InputData();
    inputData.addInput(schemaInput);

    const result = await quicktype({ inputData, lang: "schema" });
    const output = JSON.parse(result.lines.join("\n")) as {
        definitions: Record<
            string,
            { properties: Record<string, Record<string, unknown>> }
        >;
    };
    const playerProperties = output.definitions.Player.properties;
    const participantProperties = output.definitions.Participant.properties;

    expect(playerProperties.externalId).not.toHaveProperty("deprecated");
    expect(participantProperties.emailAddress).toHaveProperty(
        "deprecated",
        true,
    );
    expect(participantProperties.phoneNumber).toHaveProperty(
        "deprecated",
        true,
    );
});
