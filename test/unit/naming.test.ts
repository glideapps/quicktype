import { describe, expect, it } from "vitest";

import {
    DependencyName,
    Namer,
    Namespace,
    SimpleName,
    assignNames,
    keywordNamespace,
} from "../../packages/quicktype-core/src/Naming.js";

const identityNamer = new Namer("identity", (name) => name, ["renamed"]);

describe("assignNames", () => {
    it("revisits an unfinished namespace after a dependency is named", () => {
        const firstNamespace = new Namespace("first", undefined, [], []);
        const secondNamespace = new Namespace("second", undefined, [], []);
        const first = firstNamespace.add(
            new SimpleName(["first"], identityNamer, 1),
        );
        const dependency = secondNamespace.add(
            new SimpleName(["dependency"], identityNamer, 1),
        );
        const dependent = firstNamespace.add(
            new DependencyName(
                identityNamer,
                2,
                (lookup) => `${lookup(dependency)}Dependent`,
            ),
        );

        const names = assignNames([firstNamespace, secondNamespace]);

        expect(names.get(first)).toBe("first");
        expect(names.get(dependency)).toBe("dependency");
        expect(names.get(dependent)).toBe("dependencyDependent");
    });

    it("caches and observes forbidden namespace members", () => {
        const reserved = keywordNamespace("reserved", ["match"]);
        const namespace = new Namespace("names", undefined, [reserved], []);
        const conflicting = namespace.add(
            new SimpleName(["match"], identityNamer, 1),
        );

        const forbidden = namespace.forbiddenNameds;
        expect(namespace.forbiddenNameds).toBe(forbidden);
        expect(forbidden).toEqual(reserved.members);

        const names = assignNames([reserved, namespace]);
        expect(names.get(conflicting)).toBe("renamed_match");
    });
});
