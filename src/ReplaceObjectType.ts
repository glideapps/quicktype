"use strict";

import { Set, OrderedMap } from "immutable";

import { TypeGraph } from "./TypeGraph";
import { StringTypeMapping, GraphRewriteBuilder, TypeRef } from "./TypeBuilder";
import { ObjectType, ClassProperty } from "./Type";
import { defined } from "./Support";
import { emptyTypeAttributes } from "./TypeAttributes";

export function replaceObjectType(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    _conflateNumbers: boolean
): TypeGraph {
    function replace(
        setOfOneType: Set<ObjectType>,
        builder: GraphRewriteBuilder<ObjectType>,
        forwardingRef: TypeRef
    ): TypeRef {
        const o = defined(setOfOneType.first());
        const attributes = o.getAttributes();
        const properties = o.properties;
        const additionalProperties = o.additionalProperties;

        function reconstituteProperties(): OrderedMap<string, ClassProperty> {
            return properties.map(cp => new ClassProperty(builder.reconstituteTypeRef(cp.typeRef), cp.isOptional));
        }

        function makeClass(): TypeRef {
            return builder.getUniqueClassType(attributes, true, reconstituteProperties(), forwardingRef);
        }

        function reconstituteAdditionalProperties(): TypeRef {
            return builder.reconstituteType(defined(additionalProperties));
        }

        if (additionalProperties === undefined) {
            return makeClass();
        }

        if (properties.isEmpty()) {
            const tref = builder.getMapType(reconstituteAdditionalProperties(), forwardingRef);
            builder.addAttributes(tref, attributes);
            return tref;
        }

        if (additionalProperties.kind === "any") {
            // FIXME: Warn that we're losing additional property semantics.
            builder.setLostTypeAttributes();
            return makeClass();
        }

        // FIXME: Warn that we're losing class semantics.
        const propertyTypes = properties
            .map(cp => cp.type)
            .toOrderedSet()
            .add(additionalProperties);
        let union = builder.lookupTypeRefs(propertyTypes.toArray().map(t => t.typeRef));
        if (union === undefined) {
            const reconstitutedTypes = propertyTypes.map(t => builder.reconstituteType(t));
            union = builder.getUniqueUnionType(emptyTypeAttributes, reconstitutedTypes);

            // This is the direct unification alternative.  Weirdly enough, it is a tiny
            // bit slower.  It gives the same results.
            /*
            union = unifyTypes(
                propertyTypes,
                combineTypeAttributes(propertyTypes.toArray().map(t => t.getAttributes())),
                builder,
                unionBuilderForUnification(builder, false, false, false, conflateNumbers),
                conflateNumbers
            );
            */
        }

        const mapType = builder.getMapType(union, forwardingRef);
        builder.addAttributes(mapType, attributes);
        return mapType;
    }

    const allObjectTypes = graph.allTypesUnordered().filter(t => t instanceof ObjectType) as Set<ObjectType>;
    const groups = allObjectTypes.toArray().map(t => [t]);
    return graph.rewrite("replace object type", stringTypeMapping, false, groups, replace);
}
