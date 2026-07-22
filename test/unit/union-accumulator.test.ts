import { describe, expect, it } from "vitest";

import { stringTypesTypeAttributeKind } from "../../packages/quicktype-core/src/attributes/StringTypes.js";
import { emptyTypeAttributes } from "../../packages/quicktype-core/src/attributes/TypeAttributes.js";
import { defined } from "../../packages/quicktype-core/src/support/Support.js";
import { UnionAccumulator } from "../../packages/quicktype-core/src/UnionBuilder.js";

describe("UnionAccumulator string cases", () => {
    it("combines case counts without counting duplicates within one batch", () => {
        const accumulator = new UnionAccumulator<never, never>(true);
        accumulator.addStringCase("red", 2, emptyTypeAttributes);
        accumulator.addStringCases(["blue", "blue"], emptyTypeAttributes);

        const attributes = defined(accumulator.getMemberKinds().get("string"));
        const stringTypes = defined(
            stringTypesTypeAttributeKind.tryGetInAttributes(attributes),
        );

        expect(Array.from(defined(stringTypes.cases))).toEqual([
            ["red", 2],
            ["blue", 1],
        ]);
    });

    it("keeps an unrestricted string unrestricted", () => {
        const accumulator = new UnionAccumulator<never, never>(true);
        accumulator.addStringCase("red", 1, emptyTypeAttributes);
        accumulator.addStringType("string", emptyTypeAttributes);

        const attributes = defined(accumulator.getMemberKinds().get("string"));
        const stringTypes = defined(
            stringTypesTypeAttributeKind.tryGetInAttributes(attributes),
        );

        expect(stringTypes.cases).toBeUndefined();
    });
});
