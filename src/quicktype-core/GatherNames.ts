import * as pluralize from "pluralize";

import { TypeGraph } from "./TypeGraph";
import { Type, ObjectType } from "./Type";
import { matchCompoundType, nullableFromUnion } from "./TypeUtils";
import { TypeNames, namesTypeAttributeKind, TooManyTypeNames, tooManyNamesThreshold } from "./TypeNames";
import { defined, panic, assert } from "./support/Support";
import { transformationForType } from "./Transformers";
import { setUnion, setMap, setSortBy } from "./support/Containers";

class UniqueQueue<T> {
    private readonly _present = new Set<T>();
    private _queue: (T | undefined)[] = [];
    private _front = 0;

    get size(): number {
        return this._queue.length - this._front;
    }

    get isEmpty(): boolean {
        return this.size <= 0;
    }

    push(v: T): void {
        if (this._present.has(v)) return;
        this._queue.push(v);
        this._present.add(v);
    }

    unshift(): T {
        assert(!this.isEmpty, "Trying to unshift from an empty queue");
        const v = this._queue[this._front];
        if (v === undefined) {
            return panic("Value should have been present in queue");
        }
        this._queue[this._front] = undefined;
        this._front += 1;
        this._present.delete(v);

        if (this._front > this.size) {
            this._queue = this._queue.slice(this._front);
            this._front = 0;
        }

        return v;
    }
}

// `gatherNames` infers names from given names and property names.
//
// 1. Propagate type and property names down to children.  Let's say
//    we start with JSON like this, and we name the top-level `TopLevel`:
//
//    {
//      "foos": [ [ { "bar": 123 } ] ]
//    }
//
//    We use a work-list algorithm to first add the name `TopLevel` to
//    the outermost class type.  Then we propagate the property name
//    `foos` to the outer array, which in turn propagates its singular
//    `foo` to the inner array type.  That tries to singularize `foo`,
//    but it's already singular, so `foo` is added as a name for the
//    inner class.  We also then add `bar` to the name of the integer
//    type.
//
// 2. Add "ancestor" alternatives and some "direct" alternatives.
//    Direct alternatives are those that don't contain any ancestor
//    names, whereas ancestor alternatives do. What we do here is add
//    names of the form `TopLevel_foo` and `TopLevel_foo_class` as
//    ancestor alternatives to the inner class, and `foo_element` as
//    a direct alternative, the latter because it's an element in an
//    array.
//
// 3. Add more direct alternatives to the type names.  The reason we're
//    doing this separately from step 2 is because step 2 only requires
//    iterating over the types, wheras this step iterates over
//    ancestor/descendant relationships.  In this case we would add
//    `TopLevel_class`, and `foo_class` to the outer and inner classes,
//    respectively.  We do similar stuff for all the other types.
//
// 4. For each type, set its inferred names to what we gathered in
//    step 1, and its alternatives to a union of its direct and ancestor
//    alternatives, gathered in steps 2 and 3.

export function gatherNames(graph: TypeGraph, debugPrint: boolean): void {
    function setNames(t: Type, tn: TypeNames): void {
        graph.attributeStore.set(namesTypeAttributeKind, t, tn);
    }

    for (const t of graph.allTypesUnordered()) {
        if (t.hasNames) {
            setNames(t, t.getNames().clearInferred());
        }
    }

    const queue = new UniqueQueue<Type>();
    // null means there are too many
    const namesForType = new Map<Type, ReadonlySet<string> | null>();

    function addNames(t: Type, names: ReadonlySet<string> | null) {
        // Always use the type's given names if it has some
        if (t.hasNames) {
            const originalNames = t.getNames();
            if (!originalNames.areInferred) {
                names = originalNames.names;
            }
        }

        const oldNames = namesForType.get(t);
        if (oldNames === null) return;

        let newNames: ReadonlySet<string> | null;
        if (oldNames === undefined) {
            newNames = names;
        } else if (names === null) {
            newNames = null;
        } else {
            newNames = setUnion(oldNames, names);
        }

        if (newNames !== null && newNames.size >= tooManyNamesThreshold) {
            newNames = null;
        }
        namesForType.set(t, newNames);

        const transformation = transformationForType(t);
        if (transformation !== undefined) {
            addNames(transformation.targetType, names);
        }

        if (oldNames !== undefined && newNames !== null) {
            if (oldNames.size === newNames.size) {
                return;
            }
        } else if (oldNames === newNames) {
            return;
        }

        queue.push(t);
    }

    for (const [name, t] of graph.topLevels) {
        addNames(t, new Set([name]));
    }

    while (!queue.isEmpty) {
        const t = queue.unshift();

        const names = defined(namesForType.get(t));
        if (t instanceof ObjectType) {
            const properties = t.getSortedProperties();
            for (const [propertyName, property] of properties) {
                addNames(property.type, new Set([propertyName]));
            }

            const values = t.getAdditionalProperties();
            if (values !== undefined) {
                addNames(values, names === null ? null : setMap(names, pluralize.singular));
            }
        } else {
            matchCompoundType(
                t,
                arrayType => {
                    addNames(arrayType.items, names === null ? null : setMap(names, pluralize.singular));
                },
                _classType => panic("We handled this above"),
                _mapType => panic("We handled this above"),
                _objectType => panic("We handled this above"),
                unionType => {
                    const members = setSortBy(unionType.members, member => member.kind);
                    for (const memberType of members) {
                        addNames(memberType, names);
                    }
                }
            );
        }
    }

    if (debugPrint) {
        for (const t of graph.allTypesUnordered()) {
            const names = namesForType.get(t);
            if (names === undefined) return;

            const index = t.index;
            console.log(`${index}: ${names === null ? "*** too many ***" : Array.from(names).join(" ")}`);
        }
    }

    // null means there are too many
    const directAlternativesForType = new Map<Type, ReadonlySet<string> | null>();
    const ancestorAlternativesForType = new Map<Type, ReadonlySet<string> | null>();
    const pairsProcessed = new Map<Type | undefined, Set<Type>>();

    function addAlternatives(
        existing: ReadonlySet<string> | undefined,
        alternatives: string[]
    ): ReadonlySet<string> | undefined | null {
        if (alternatives.length === 0) {
            return existing;
        }

        if (existing === undefined) {
            existing = new Set();
        }
        existing = setUnion(existing, alternatives);
        if (existing.size < tooManyNamesThreshold) {
            return existing;
        }
        return null;
    }

    function processType(ancestor: Type | undefined, t: Type, alternativeSuffix: string | undefined) {
        const names = defined(namesForType.get(t));

        let processedEntry = pairsProcessed.get(ancestor);
        if (processedEntry === undefined) processedEntry = new Set();
        if (processedEntry.has(t)) return;
        processedEntry.add(t);
        pairsProcessed.set(ancestor, processedEntry);

        const transformation = transformationForType(t);
        if (transformation !== undefined) {
            processType(ancestor, transformation.targetType, alternativeSuffix);
        }

        let ancestorAlternatives = ancestorAlternativesForType.get(t);
        let directAlternatives = directAlternativesForType.get(t);
        if (names === null) {
            ancestorAlternatives = null;
            directAlternatives = null;
        } else {
            if (ancestor !== undefined && ancestorAlternatives !== null) {
                const ancestorNames = namesForType.get(ancestor);
                if (ancestorNames === null) {
                    ancestorAlternatives = null;
                } else if (ancestorNames !== undefined) {
                    const alternatives: string[] = [];
                    for (const name of names) {
                        alternatives.push(...Array.from(ancestorNames).map(an => `${an}_${name}`));
                        // FIXME: add alternatives with the suffix here, too?

                        alternatives.push(...Array.from(ancestorNames).map(an => `${an}_${name}_${t.kind}`));
                        // FIXME: add alternatives with the suffix here, too?
                    }

                    ancestorAlternatives = addAlternatives(ancestorAlternatives, alternatives);
                }
            }

            if (alternativeSuffix !== undefined && directAlternatives !== null) {
                const alternatives: string[] = [];
                for (const name of names) {
                    // FIXME: we should only add these for names we couldn't singularize
                    alternatives.push(`${name}_${alternativeSuffix}`);
                }

                directAlternatives = addAlternatives(directAlternatives, alternatives);
            }
        }

        if (ancestorAlternatives !== undefined) {
            ancestorAlternativesForType.set(t, ancestorAlternatives);
        }
        if (directAlternatives !== undefined) {
            directAlternativesForType.set(t, directAlternatives);
        }

        if (t instanceof ObjectType) {
            const properties = t.getSortedProperties();
            for (const [_, property] of properties) {
                processType(t, property.type, undefined);
            }

            const values = t.getAdditionalProperties();
            if (values !== undefined) {
                processType(properties.size === 0 ? ancestor : t, values, "value");
            }
        } else {
            matchCompoundType(
                t,
                arrayType => {
                    processType(ancestor, arrayType.items, "element");
                },
                _classType => panic("We handled this above"),
                _mapType => panic("We handled this above"),
                _objectType => panic("We handled this above"),
                unionType => {
                    const members = setSortBy(unionType.members, member => member.kind);
                    const unionHasGivenName = unionType.hasNames && !unionType.getNames().areInferred;
                    const unionIsAncestor = unionHasGivenName || nullableFromUnion(unionType) === null;
                    const ancestorForMembers = unionIsAncestor ? unionType : ancestor;
                    for (const memberType of members) {
                        processType(ancestorForMembers, memberType, undefined);
                    }
                }
            );
        }
    }

    for (const [_, t] of graph.topLevels) {
        processType(undefined, t, undefined);
    }

    for (const t of graph.allTypesUnordered()) {
        const names = namesForType.get(t);
        if (names === undefined) continue;
        if (names === null) {
            directAlternativesForType.set(t, null);
            continue;
        }
        let alternatives = directAlternativesForType.get(t);
        if (alternatives === null) continue;
        if (alternatives === undefined) {
            alternatives = new Set();
        }

        alternatives = setUnion(alternatives, setMap(names, name => `${name}_${t.kind}`));
        directAlternativesForType.set(t, alternatives);
    }

    for (const t of graph.allTypesUnordered()) {
        const names = namesForType.get(t);
        if (names === undefined) continue;

        let typeNames: TypeNames;
        if (names === null) {
            typeNames = new TooManyTypeNames(true);
        } else {
            const ancestorAlternatives = ancestorAlternativesForType.get(t);
            const directAlternatives = directAlternativesForType.get(t);

            let alternatives: ReadonlySet<string> | undefined;
            if (ancestorAlternatives === null && directAlternatives === null) {
                alternatives = undefined;
            } else {
                if (directAlternatives !== null && directAlternatives !== undefined) {
                    alternatives = directAlternatives;
                } else {
                    alternatives = new Set();
                }
                if (ancestorAlternatives !== null && ancestorAlternatives !== undefined) {
                    alternatives = setUnion(alternatives, ancestorAlternatives);
                }
            }

            typeNames = TypeNames.make(names, alternatives, true);
        }

        setNames(t, t.hasNames ? t.getNames().add([typeNames]) : typeNames);
    }
}
