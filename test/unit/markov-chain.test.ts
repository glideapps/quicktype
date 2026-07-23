import { describe, expect, test } from "vitest";

import {
    evaluate,
    evaluateFull,
    load,
} from "../../packages/quicktype-core/src/MarkovChain.js";

describe("Markov chain", () => {
    test("decodes the compact probability table", () => {
        const chain = load();

        expect(chain.probabilityCodes).toHaveLength(65 ** 3);
        expect(chain.probabilities).toHaveLength(6);
        expect(chain.probabilities[0]).toBeCloseTo(0.0001);
    });

    test("keeps representative inference scores stable", () => {
        const chain = load();
        const [probability, scores] = evaluateFull(chain, "contactInformation");

        expect(probability).toBe(0.10493792217669691);
        expect(scores).toEqual([
            0.1738850325345993, 0.043580953031778336, 0.1738850325345993,
            0.043580953031778336, 0.1738850325345993, 0.0008568746852688491,
            0.1738850325345993, 0.1738850325345993, 0.1738850325345993,
            0.1738850325345993, 0.1738850325345993, 0.1738850325345993,
            0.1738850325345993, 0.1738850325345993, 0.1738850325345993,
            0.1738850325345993,
        ]);
        expect(evaluate(chain, "contactInformation")).toBe(probability);
    });

    test("treats non-corpus characters as unseen", () => {
        const chain = load();

        expect(evaluateFull(chain, "aébc")).toEqual([0.0001, [0.0001, 0.0001]]);
        expect(evaluate(chain, "id")).toBe(1);
    });

    test("scores representative property names", () => {
        const chain = load();
        const words = [
            "url",
            "json",
            "my_property",
            "ordinary",
            "different",
            "189512",
            "2BTZIqw0ntH9MvilQ3ewNY",
            "0uBTNdNGb2OY5lou41iYL52LcDq2",
            "-KpqHmWuDOUnr1hmAhxp",
            "granularity",
            "coverage",
            "postingFrequency",
            "dataFrequency",
            "units",
            "datasetOwner",
            "organization",
            "timePeriod",
            "contactInformation",
            "\ud83d\udebe \ud83c\udd92 \ud83c\udd93 \ud83c\udd95 \ud83c\udd96 \ud83c\udd97 \ud83c\udd99 \ud83c\udfe7",
        ];

        for (const word of words) {
            const probability = evaluate(chain, word);
            expect(Number.isFinite(probability)).toBe(true);
            expect(probability).toBeGreaterThan(0);
        }
    });

    test("preserves map-inference decisions near the score boundary", () => {
        const chain = load();
        const score = (names: string[]): number =>
            names.reduce(
                (product, name) => product * evaluate(chain, name),
                1,
            ) **
            (1 / names.length);
        const limit = (propertyCount: number): number => {
            const exponent = 5;
            const scale = 22 ** exponent;
            return (
                (propertyCount + 2) ** exponent / scale +
                (0.0025 - 3 ** exponent / scale)
            );
        };
        const originalClasses = [
            [
                "designation",
                "discovery_date",
                "h_mag",
                "i_deg",
                "moid_au",
                "orbit_class",
                "period_yr",
                "pha",
                "q_au_1",
                "q_au_2",
            ],
            [
                "id",
                "name",
                "dataTypeName",
                "description",
                "fieldName",
                "position",
                "renderTypeName",
                "tableColumnId",
                "width",
                "cachedContents",
                "format",
            ],
            [
                "product",
                "totallooseoffers",
                "schk",
                "match",
                "details",
                "page",
                "totalpages",
                "totalresultsreturned",
                "totalresultsavailable",
                "category",
            ],
        ];
        const closestMap = [
            "ita_contact_email",
            "company_name",
            "company_phone",
            "company_address",
            "company_website",
            "company_description",
            "company_email",
            "ita_office",
            "contact_title",
            "contact_name",
            "category",
        ];

        for (const names of originalClasses) {
            expect(score(names)).toBeGreaterThan(limit(names.length));
        }
        expect(score(closestMap)).toBeLessThan(limit(closestMap.length));
    });
});
