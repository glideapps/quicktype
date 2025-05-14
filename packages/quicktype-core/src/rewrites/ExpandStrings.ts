import {
    areEqual,
    iterableFirst,
    iterableReduce,
    iterableSome,
    mapFilter,
    setIntersect,
    setIsSuperset,
    setUnion,
} from "collection-utils";

import { StringTypes } from "../attributes/StringTypes";
import { emptyTypeAttributes } from "../attributes/TypeAttributes";
import { type GraphRewriteBuilder } from "../GraphRewriting";
import { type RunContext } from "../Run";
import { assert, defined } from "../support/Support";
import { type PrimitiveType } from "../Type/Type";
import { type TypeGraph } from "../Type/TypeGraph";
import { type TypeRef } from "../Type/TypeRef";
import { stringTypesForType } from "../Type/TypeUtils";

const MIN_LENGTH_FOR_ENUM = 10;

const MIN_LENGTH_FOR_OVERLAP = 5;
const REQUIRED_OVERLAP = 3 / 4;

export type EnumInference = "none" | "all" | "infer";

interface EnumInfo {
    cases: ReadonlySet<string>;
    numValues: number;
}

function isOwnEnum({ numValues, cases }: EnumInfo): boolean {
    return (
        numValues >= MIN_LENGTH_FOR_ENUM && cases.size < Math.sqrt(numValues)
    );
}

function enumCasesOverlap(
    newCases: ReadonlySet<string>,
    existingCases: ReadonlySet<string>,
    newAreSubordinate: boolean,
): boolean {
    const smaller = newAreSubordinate
        ? newCases.size
        : Math.min(newCases.size, existingCases.size);
    const overlap = setIntersect(newCases, existingCases).size;
    return overlap >= smaller * REQUIRED_OVERLAP;
}

function isAlwaysEmptyString(cases: string[]): boolean {
    return cases.length === 1 && cases[0] === "";
}

export function expandStrings(
    ctx: RunContext,
    graph: TypeGraph,
    inference: EnumInference,
): TypeGraph {
    const stringTypeMapping = ctx.stringTypeMapping;
    const allStrings = Array.from(graph.allTypesUnordered()).filter(
        (t) =>
            t.kind === "string" &&
            stringTypesForType(t as PrimitiveType).isRestricted,
    ) as PrimitiveType[];

    function makeEnumInfo(t: PrimitiveType): EnumInfo | undefined {
        const stringTypes = stringTypesForType(t);
        const mappedStringTypes =
            stringTypes.applyStringTypeMapping(stringTypeMapping);
        if (!mappedStringTypes.isRestricted) return undefined;

        const cases = defined(mappedStringTypes.cases);
        if (cases.size === 0) return undefined;

        const numValues = iterableReduce(cases.values(), 0, (a, b) => a + b);

        if (inference !== "all") {
            const keys = Array.from(cases.keys());
            if (isAlwaysEmptyString(keys)) return undefined;

            const someCaseIsNotNumber = iterableSome(
                keys,
                (key) => /^[-+]?[0-9]+(\.[0-9]+)?$/.test(key) === false,
            );
            if (!someCaseIsNotNumber) return undefined;
        }

        return { cases: new Set(cases.keys()), numValues };
    }

    const enumInfos = new Map<PrimitiveType, EnumInfo>();
    const enumSets: Array<ReadonlySet<string>> = [];

    if (inference !== "none") {
        for (const t of allStrings) {
            const enumInfo = makeEnumInfo(t);
            if (enumInfo === undefined) continue;
            enumInfos.set(t, enumInfo);
        }

        // FIXME: refactor this
        // eslint-disable-next-line no-inner-declarations
        function findOverlap(
            newCases: ReadonlySet<string>,
            newAreSubordinate: boolean,
        ): number {
            return enumSets.findIndex((s) =>
                enumCasesOverlap(newCases, s, newAreSubordinate),
            );
        }

        // First, make case sets for all the enums that stand on their own.  If
        // we find some overlap (searching eagerly), make unions.
        for (const t of Array.from(enumInfos.keys())) {
            const enumInfo = defined(enumInfos.get(t));
            const cases = enumInfo.cases;

            if (inference === "all") {
                enumSets.push(cases);
            } else {
                if (!isOwnEnum(enumInfo)) continue;

                const index = findOverlap(cases, false);
                if (index >= 0) {
                    // console.log(
                    //     `unifying ${JSON.stringify(Array.from(cases))} with ${JSON.stringify(
                    //         Array.from(enumSets[index])
                    //     )}`
                    // );
                    enumSets[index] = setUnion(enumSets[index], cases);
                } else {
                    // console.log(`adding new ${JSON.stringify(Array.from(cases))}`);
                    enumSets.push(cases);
                }
            }

            // Remove the ones we're done with.
            enumInfos.delete(t);
        }

        if (inference === "all") {
            assert(enumInfos.size === 0);
        }

        // Now see if we can unify the rest with some a set we found in the
        // previous step.
        for (const [, enumInfo] of enumInfos.entries()) {
            if (enumInfo.numValues < MIN_LENGTH_FOR_OVERLAP) continue;

            const index = findOverlap(enumInfo.cases, true);
            if (index >= 0) {
                // console.log(
                //     `late unifying ${JSON.stringify(Array.from(enumInfo.cases))} with ${JSON.stringify(
                //         Array.from(enumSets[index])
                //     )}`
                // );
                enumSets[index] = setUnion(enumSets[index], enumInfo.cases);
            }
        }
    }

    function replaceString(
        group: ReadonlySet<PrimitiveType>,
        builder: GraphRewriteBuilder<PrimitiveType>,
        forwardingRef: TypeRef,
    ): TypeRef {
        assert(group.size === 1);
        const t = defined(iterableFirst(group));
        const stringTypes = stringTypesForType(t);
        const attributes = mapFilter(
            t.getAttributes(),
            (a) => a !== stringTypes,
        );
        const mappedStringTypes =
            stringTypes.applyStringTypeMapping(stringTypeMapping);

        if (!mappedStringTypes.isRestricted) {
            return builder.getStringType(
                attributes,
                StringTypes.unrestricted,
                forwardingRef,
            );
        }

        const setMatches = inference === "all" ? areEqual : setIsSuperset;

        const types: TypeRef[] = [];
        const cases = defined(mappedStringTypes.cases);
        if (cases.size > 0) {
            const keys = new Set(cases.keys());
            const fullCases = enumSets.find((s) => setMatches(s, keys));
            if (
                inference !== "none" &&
                !isAlwaysEmptyString(Array.from(keys)) &&
                fullCases !== undefined
            ) {
                types.push(builder.getEnumType(emptyTypeAttributes, fullCases));
            } else {
                return builder.getStringType(
                    attributes,
                    StringTypes.unrestricted,
                    forwardingRef,
                );
            }
        }

        const transformations = mappedStringTypes.transformations;
        // FIXME: This is probably wrong, or at least overly conservative.  This is for the case
        // where some attributes are identity ones, i.e. where we can't merge the primitive types,
        // like it happens in the line after the `if`.  The case where this occurred was with URI
        // attributes: we had two separate string types with different URI attributes, but because
        // both are rewritten via `getPrimitiveType` below without any attributes, they end up
        // being the same string type.
        if (types.length === 0 && transformations.size === 1) {
            const kind = defined(iterableFirst(transformations));
            return builder.getPrimitiveType(kind, attributes, forwardingRef);
        }

        types.push(
            ...Array.from(transformations).map((k) =>
                builder.getPrimitiveType(k),
            ),
        );
        assert(types.length > 0, "We got an empty string type");
        return builder.getUnionType(attributes, new Set(types), forwardingRef);
    }

    return graph.rewrite(
        "expand strings",
        stringTypeMapping,
        false,
        allStrings.map((t) => [t]),
        ctx.debugPrintReconstitution,
        replaceString,
    );
}
