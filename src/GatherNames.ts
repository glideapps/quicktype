"use strict";

import { Set, OrderedSet } from "immutable";
import * as pluralize from "pluralize";

import { TypeGraph } from "./TypeGraph";
import { matchCompoundType, Type } from "./Type";

export function gatherNames(graph: TypeGraph): void {
    graph.allTypesUnordered().forEach(t => {
        if (t.isNamedType()) {
            t.clearInferredNames();
        }
    });

    let processed: Set<Type> = Set();

    function processType(t: Type, names: OrderedSet<string>, parentNames: OrderedSet<string> | null) {
        if (t.isNamedType()) {
            const alternatives: string[] = [];
            names.forEach(name => {
                if (parentNames !== null) {
                    alternatives.push(...parentNames.map(pn => `${pn}_${name}`).toArray());
                }
                alternatives.push(`${name}_${t.kind}`);
                if (parentNames !== null) {
                    alternatives.push(...parentNames.map(pn => `${pn}_${name}_${t.kind}`).toArray());
                }
            });
            t.addNames({ names, alternatives: OrderedSet(alternatives) }, true);
        }
        if (processed.has(t)) return;
        processed = processed.add(t);
        matchCompoundType(
            t,
            arrayType => {
                processType(arrayType.items, names.map(pluralize.singular), parentNames);
            },
            classType => {
                const properties = classType.properties.sortBy((_, n) => n);
                properties.forEach((propertyType, propertyName) => {
                    processType(propertyType, OrderedSet([propertyName]), names);
                });
            },
            mapType => {
                processType(mapType.values, names.map(pluralize.singular), parentNames);
            },
            unionType => {
                const members = unionType.members.sortBy(member => member.kind);
                members.forEach(memberType => {
                    processType(memberType, names, parentNames);
                });
            }
        );
    }

    graph.topLevels.forEach((t, name) => {
        processType(t, OrderedSet([name]), null);
    });
}
