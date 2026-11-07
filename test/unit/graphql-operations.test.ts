import { readFileSync } from "node:fs";

import { buildSchema, introspectionFromSchema } from "graphql";
import { InputData, quicktype } from "quicktype-core";
import { describe, expect, test } from "vitest";

import { GraphQLInput } from "../../packages/quicktype-graphql-input/src";

const schema = {
    data: introspectionFromSchema(
        buildSchema(`
            type Query {
                viewer: User!
                user: User!
            }
            type Mutation {
                renameUser: User!
            }
            type User {
                id: ID!
                name: String!
            }
        `),
    ),
};
const fixtureDirectory = "test/inputs/graphql/multiple-operations";
const queries = readFileSync(`${fixtureDirectory}/queries.graphql`, "utf8");
const responses = JSON.parse(
    readFileSync(`${fixtureDirectory}/responses.json`, "utf8"),
);

async function render(
    sources: { name: string; query: string }[],
    lang = "javascript",
): Promise<string> {
    const input = new GraphQLInput();
    for (const source of sources) {
        await input.addSource({ ...source, schema });
    }
    const inputData = new InputData();
    inputData.addInput(input);
    const result = await quicktype({ inputData, lang });
    return result.lines.join("\n");
}

interface GeneratedConverters {
    toViewerQuery: (json: string) => unknown;
    viewerQueryToJson: (value: unknown) => string;
    toUserQuery: (json: string) => unknown;
    userQueryToJson: (value: unknown) => string;
}

describe("GraphQL operation names", () => {
    test("round-trips each query in a document with a shared fragment", async () => {
        const output = await render([{ name: "Response", query: queries }]);
        const generatedModule = { exports: {} };
        new Function("module", output)(generatedModule);
        const convert = generatedModule.exports as GeneratedConverters;

        const viewer = convert.toViewerQuery(JSON.stringify(responses.viewer));
        expect(JSON.parse(convert.viewerQueryToJson(viewer))).toEqual(
            responses.viewer,
        );
        const user = convert.toUserQuery(JSON.stringify(responses.user));
        expect(JSON.parse(convert.userQueryToJson(user))).toEqual(
            responses.user,
        );
        expect(() =>
            convert.toViewerQuery(JSON.stringify(responses.user)),
        ).toThrow();
        expect(() =>
            convert.toUserQuery(JSON.stringify(responses.viewer)),
        ).toThrow();
    });

    test.each([
        "swift",
        "kotlin",
    ])("generates both operations for %s", async (lang) => {
        const output = await render(
            [{ name: "Response", query: queries }],
            lang,
        );
        expect(output).toMatch(/(?:struct|class) ViewerQuery\b/);
        expect(output).toMatch(/(?:struct|class) UserQuery\b/);
    });

    test.each([
        "query ViewerQuery",
        "",
    ])("preserves the source name for a single operation (%s)", async (operation) => {
        const output = await render([
            { name: "CustomResponse", query: `${operation} { viewer { id } }` },
        ]);
        expect(output).toContain("function toCustomResponse(");
        expect(output).not.toContain("function toViewerQuery(");
    });

    test("uses operation names when there are multiple sources", async () => {
        const output = await render([
            { name: "First", query: "query ViewerQuery { viewer { id } }" },
            { name: "Second", query: "query UserQuery { user { id } }" },
        ]);
        expect(output).toContain("function toViewerQuery(");
        expect(output).toContain("function toUserQuery(");
        expect(output).not.toContain("function toFirst(");
        expect(output).not.toContain("function toSecond(");
    });

    test("supports a query and mutation in the same document", async () => {
        const output = await render([
            {
                name: "Response",
                query: `
                    query ViewerQuery { viewer { id } }
                    mutation RenameUser { renameUser { id name } }
                `,
            },
        ]);
        expect(output).toContain("function toViewerQuery(");
        expect(output).toContain("function toRenameUser(");
    });
});
