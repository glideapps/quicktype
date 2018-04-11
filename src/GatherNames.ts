"use strict";

import { Set, OrderedSet, Map, isCollection } from "immutable";
import * as pluralize from "pluralize";

import { TypeGraph } from "./TypeGraph";
import { matchCompoundType, Type, ObjectType } from "./Type";
import { TypeNames, namesTypeAttributeKind, TooManyTypeNames, tooManyNamesThreshold } from "./TypeNames";
import { defined, panic } from "./Support";

export function gatherNames(graph: TypeGraph, debugPrint: boolean): void {
    function setNames(t: Type, tn: TypeNames): void {
        graph.attributeStore.set(namesTypeAttributeKind, t, tn);
    }

    graph.allTypesUnordered().forEach(t => {
        if (t.hasNames) {
            setNames(t, t.getNames().clearInferred());
        }
    });

    let queue = OrderedSet<Type>();
    // null means there are too many
    let namesForType = Map<Type, OrderedSet<string> | null>();

    function addNames(t: Type, names: OrderedSet<string> | null) {
        const oldNames = namesForType.get(t);
        if (oldNames === null) return;

        let newNames: OrderedSet<string> | null;
        if (oldNames === undefined) {
            newNames = names;
        } else if (names === null) {
            newNames = null;
        } else {
            newNames = oldNames.union(names);
        }

        if (newNames !== null && newNames.size >= tooManyNamesThreshold) {
            newNames = null;
        }
        namesForType = namesForType.set(t, newNames);

        if (oldNames !== undefined && newNames !== null) {
            if (oldNames.size === newNames.size) {
                return;
            }
        } else if (oldNames === newNames) {
            return;
        }

        queue = queue.add(t);
    }

    graph.topLevels.forEach((t, name) => {
        addNames(t, OrderedSet([name]));
    });

    while (!queue.isEmpty()) {
        const t = defined(queue.first());
        queue = queue.rest();

        const names = defined(namesForType.get(t));
        if (t instanceof ObjectType) {
            const properties = t.getProperties().sortBy((_, n) => n);
            properties.forEach((property, propertyName) => {
                addNames(property.type, OrderedSet([propertyName]));
            });

            const values = t.getAdditionalProperties();
            if (values !== undefined) {
                addNames(values, names === null ? null : names.map(pluralize.singular));
            }
        } else {
            matchCompoundType(
                t,
                arrayType => {
                    addNames(arrayType.items, names === null ? null : names.map(pluralize.singular));
                },
                _classType => panic("We handled this above"),
                _mapType => panic("We handled this above"),
                _objectType => panic("We handled this above"),
                unionType => {
                    const members = unionType.members.sortBy(member => member.kind);
                    members.forEach(memberType => {
                        addNames(memberType, names);
                    });
                }
            );
        }
    }

    if (debugPrint) {
        graph.allTypesUnordered().forEach(t => {
            const names = namesForType.get(t);
            if (names === undefined) return;

            const index = t.typeRef.getIndex();
            console.log(`${index}: ${names === null ? "*** too many ***" : names.join(" ")}`);
        });
    }

    // null means there are too many
    let directAlternativesForType = Map<Type, OrderedSet<string> | null>();

    // FIXME: maybe do this last, so these names get considered last for naming?
    graph.allTypesUnordered().forEach(t => {
        const names = namesForType.get(t);
        if (names === undefined) return;
        if (names === null) {
            directAlternativesForType = directAlternativesForType.set(t, null);
            return;
        }
        let alternatives = directAlternativesForType.get(t);
        if (alternatives === null) return;
        if (alternatives === undefined) {
            alternatives = OrderedSet();
        }

        alternatives = alternatives.union(names.map(name => `${name}_${t.kind}`));
        directAlternativesForType = directAlternativesForType.set(t, alternatives);
    });

    let ancestorAlternativesForType = Map<Type, OrderedSet<string> | null>();
    let pairsProcessed = Map<Type | undefined, Set<Type>>();

    function addAlternatives(
        existing: OrderedSet<string> | undefined,
        alternatives: string[]
    ): OrderedSet<string> | undefined | null {
        if (alternatives.length === 0) {
            return existing;
        }

        if (existing === undefined) {
            existing = OrderedSet();
        }
        existing = existing.union(OrderedSet(alternatives));
        if (existing.size < tooManyNamesThreshold) {
            return existing;
        }
        return null;
    }

    function processType(ancestor: Type | undefined, t: Type, alternativeSuffix: string | undefined) {
        const names = defined(namesForType.get(t));

        let processedEntry = pairsProcessed.get(ancestor);
        if (processedEntry === undefined) processedEntry = Set();
        if (processedEntry.has(t)) return;
        processedEntry = processedEntry.add(t);
        pairsProcessed = pairsProcessed.set(ancestor, processedEntry);

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
                    names.forEach(name => {
                        alternatives.push(...ancestorNames.map(an => `${an}_${name}`).toArray());
                        // FIXME: add alternatives with the suffix here, too?

                        alternatives.push(...ancestorNames.map(an => `${an}_${name}_${t.kind}`).toArray());
                        // FIXME: add alternatives with the suffix here, too?
                    });

                    ancestorAlternatives = addAlternatives(ancestorAlternatives, alternatives);
                }
            }

            if (alternativeSuffix !== undefined && directAlternatives !== null) {
                const alternatives: string[] = [];
                names.forEach(name => {
                    // FIXME: we should only add these for names we couldn't singularize
                    alternatives.push(`${name}_${alternativeSuffix}`);
                });

                directAlternatives = addAlternatives(directAlternatives, alternatives);
            }
        }

        if (ancestorAlternatives !== undefined) {
            ancestorAlternativesForType = ancestorAlternativesForType.set(t, ancestorAlternatives);
        }
        if (directAlternatives !== undefined) {
            directAlternativesForType = directAlternativesForType.set(t, directAlternatives);
        }

        if (t instanceof ObjectType) {
            const properties = t.getProperties().sortBy((_, n) => n);
            properties.forEach(property => processType(t, property.type, undefined));

            const values = t.getAdditionalProperties();
            if (values !== undefined) {
                processType(t, values, "value");
            }
        } else {
            matchCompoundType(
                t,
                arrayType => {
                    processType(t, arrayType.items, "element");
                },
                _classType => panic("We handled this above"),
                _mapType => panic("We handled this above"),
                _objectType => panic("We handled this above"),
                unionType => {
                    const members = unionType.members.sortBy(member => member.kind);
                    members.forEach(memberType => processType(t, memberType, undefined));
                }
            );
        }
    }

    graph.topLevels.forEach(t => {
        processType(undefined, t, undefined);
    });

    graph.allTypesUnordered().forEach(t => {
        const names = namesForType.get(t);
        if (names === undefined) return;

        let typeNames: TypeNames;
        if (names === null) {
            typeNames = new TooManyTypeNames(true);
        } else {
            const ancestorAlternatives = ancestorAlternativesForType.get(t);
            const directAlternatives = directAlternativesForType.get(t);

            let alternatives: OrderedSet<string> | undefined;
            if (ancestorAlternatives === null && directAlternatives === null) {
                alternatives = undefined;
            } else {
                if (isCollection(ancestorAlternatives)) {
                    alternatives = ancestorAlternatives;
                } else {
                    alternatives = OrderedSet();
                }

                if (isCollection(directAlternatives)) {
                    alternatives = alternatives.union(directAlternatives);
                }
            }

            typeNames = TypeNames.make(names, alternatives, true);
        }

        setNames(t, t.hasNames ? t.getNames().add(typeNames) : typeNames);
    });
}
