import * as http from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, test } from "vitest";

import { introspectServer } from "../../src/GraphQLIntrospection";

describe("GraphQL introspection with native fetch", () => {
    test("posts the introspection query and forwards custom headers", async () => {
        let receivedRequest:
            | {
                  method: string | undefined;
                  headers: http.IncomingHttpHeaders;
                  body: string;
              }
            | undefined;

        const server = http.createServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => {
                receivedRequest = {
                    method: request.method,
                    headers: request.headers,
                    body: Buffer.concat(chunks).toString("utf8"),
                };
                response.writeHead(200, {
                    "Content-Type": "application/json",
                });
                response.end(
                    JSON.stringify({
                        data: {
                            __schema: { queryType: { name: "Query" } },
                        },
                    }),
                );
            });
        });

        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const { port } = server.address() as AddressInfo;

        try {
            const result = await introspectServer(
                `http://127.0.0.1:${port}/graphql`,
                "POST",
                ["Authorization: Bearer test-token"],
            );

            expect(JSON.parse(result)).toMatchObject({
                data: { __schema: { queryType: { name: "Query" } } },
            });
            expect(receivedRequest?.method).toBe("POST");
            expect(receivedRequest?.headers.authorization).toBe(
                "Bearer test-token",
            );
            expect(receivedRequest?.headers["content-type"]).toBe(
                "application/json",
            );
            expect(JSON.parse(receivedRequest?.body ?? "{}").query).toContain(
                "__schema",
            );
        } finally {
            await new Promise<void>((resolve, reject) =>
                server.close((error) =>
                    error === undefined ? resolve() : reject(error),
                ),
            );
        }
    });
});
