"use strict";

import { Set, OrderedSet, List } from "immutable";
import * as pluralize from "pluralize";

import { TypeGraph } from "./TypeGraph";
import { matchCompoundType, Type, ObjectType } from "./Type";
import { TypeNames, namesTypeAttributeKind } from "./TypeNames";

export function gatherNames(graph: TypeGraph): void {
    function setNames(t: Type, tn: TypeNames): void {
        graph.attributeStore.set(namesTypeAttributeKind, t, tn);
    }

    graph.allTypesUnordered().forEach(t => {
        if (t.hasNames) {
            setNames(t, t.getNames().clearInferred());
        }
    });

    let processed: Set<List<any>> = Set();

    function processObjectType(o: ObjectType, names: OrderedSet<string>, parentNames: OrderedSet<string> | undefined) {
        const properties = o.getProperties().sortBy((_, n) => n);
        properties.forEach((property, propertyName) => {
            processType(property.type, OrderedSet([propertyName]), names);
        });

        const values = o.getAdditionalProperties();
        if (values !== undefined) {
            processType(values, names.map(pluralize.singular), parentNames, "value");
        }
    }

    function processType(
        t: Type,
        names: OrderedSet<string>,
        parentNames: OrderedSet<string> | undefined,
        alternativeSuffix?: string
    ) {
        if (t.hasNames) {
            const typeNames = t.getNames();
            if (!typeNames.areInferred) {
                names = typeNames.names;
            }
        }

        const alternatives: string[] = [];
        names.forEach(name => {
            if (alternativeSuffix !== undefined) {
                // FIXME: we should only add these for names we couldn't singularize
                alternatives.push(`${name}_${alternativeSuffix}`);
            }
            if (parentNames !== undefined) {
                alternatives.push(...parentNames.map(pn => `${pn}_${name}`).toArray());
                // FIXME: add alternatives with the suffix here, too?
            }
            alternatives.push(`${name}_${t.kind}`);
            if (parentNames !== undefined) {
                alternatives.push(...parentNames.map(pn => `${pn}_${name}_${t.kind}`).toArray());
                // FIXME: add alternatives with the suffix here, too?
            }
        });
        const newNames = new TypeNames(names, OrderedSet(alternatives), true);
        setNames(t, t.hasNames ? t.getNames().add(newNames) : newNames);
        const processedEntry = List([t, names, parentNames]);
        if (processed.has(processedEntry)) return;
        processed = processed.add(processedEntry);
        matchCompoundType(
            t,
            arrayType => {
                processType(arrayType.items, names.map(pluralize.singular), parentNames, "element");
            },
            classType => processObjectType(classType, names, parentNames),
            mapType => processObjectType(mapType, names, parentNames),
            objectType => processObjectType(objectType, names, parentNames),
            unionType => {
                const members = unionType.members.sortBy(member => member.kind);
                members.forEach(memberType => {
                    processType(memberType, names, parentNames);
                });
            }
        );
    }

    graph.topLevels.forEach((t, name) => {
        processType(t, OrderedSet([name]), undefined);
    });
}
