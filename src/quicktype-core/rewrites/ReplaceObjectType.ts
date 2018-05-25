import { Set, OrderedMap } from "immutable";

import { TypeGraph } from "../TypeGraph";
import { StringTypeMapping, TypeRef } from "../TypeBuilder";
import { GraphRewriteBuilder } from "../GraphRewriting";
import { ObjectType, ClassProperty } from "../Type";
import { defined } from "../support/Support";
import { emptyTypeAttributes } from "../TypeAttributes";

export function replaceObjectType(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    _conflateNumbers: boolean,
    leaveFullObjects: boolean,
    debugPrintReconstitution: boolean
): TypeGraph {
    function replace(
        setOfOneType: Set<ObjectType>,
        builder: GraphRewriteBuilder<ObjectType>,
        forwardingRef: TypeRef
    ): TypeRef {
        const o = defined(setOfOneType.first());
        const attributes = o.getAttributes();
        const properties = o.getProperties();
        const additionalProperties = o.getAdditionalProperties();

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
            return builder.getMapType(attributes, reconstituteAdditionalProperties(), forwardingRef);
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

        return builder.getMapType(attributes, union, forwardingRef);
    }

    const allObjectTypes = graph.allTypesUnordered().filter(t => t.kind === "object") as Set<ObjectType>;
    const objectTypesToReplace = leaveFullObjects
        ? allObjectTypes.filter(o => o.getProperties().isEmpty() || o.getAdditionalProperties() === undefined)
        : allObjectTypes;
    const groups = objectTypesToReplace.toArray().map(t => [t]);
    return graph.rewrite("replace object type", stringTypeMapping, false, groups, debugPrintReconstitution, replace);
}
