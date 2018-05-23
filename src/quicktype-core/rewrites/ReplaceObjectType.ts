import { TypeGraph, TypeRef } from "../TypeGraph";
import { StringTypeMapping } from "../TypeBuilder";
import { GraphRewriteBuilder } from "../GraphRewriting";
import { ObjectType, ClassProperty } from "../Type";
import { defined } from "../support/Support";
import { emptyTypeAttributes } from "../TypeAttributes";
import { setFilter, iterableFirst, mapMap, setMap } from "../support/Containers";

export function replaceObjectType(
    graph: TypeGraph,
    stringTypeMapping: StringTypeMapping,
    _conflateNumbers: boolean,
    leaveFullObjects: boolean,
    debugPrintReconstitution: boolean
): TypeGraph {
    function replace(
        setOfOneType: ReadonlySet<ObjectType>,
        builder: GraphRewriteBuilder<ObjectType>,
        forwardingRef: TypeRef
    ): TypeRef {
        const o = defined(iterableFirst(setOfOneType));
        const attributes = o.getAttributes();
        const properties = o.getProperties();
        const additionalProperties = o.getAdditionalProperties();

        function reconstituteProperties(): ReadonlyMap<string, ClassProperty> {
            return mapMap(properties, cp =>
                builder.makeClassProperty(builder.reconstituteTypeRef(cp.typeRef), cp.isOptional)
            );
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

        if (properties.size === 0) {
            return builder.getMapType(attributes, reconstituteAdditionalProperties(), forwardingRef);
        }

        if (additionalProperties.kind === "any") {
            // FIXME: Warn that we're losing additional property semantics.
            builder.setLostTypeAttributes();
            return makeClass();
        }

        // FIXME: Warn that we're losing class semantics.
        const propertyTypes = setMap(properties.values(), cp => cp.type).add(additionalProperties);
        let union = builder.lookupTypeRefs(Array.from(propertyTypes).map(t => t.typeRef));
        if (union === undefined) {
            const reconstitutedTypes = setMap(propertyTypes, t => builder.reconstituteType(t));
            union = builder.getUniqueUnionType(emptyTypeAttributes, new Set(reconstitutedTypes));

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

    const allObjectTypes = setFilter(graph.allTypesUnordered(), t => t.kind === "object") as Set<ObjectType>;
    const objectTypesToReplace = leaveFullObjects
        ? setFilter(allObjectTypes, o => o.getProperties().size === 0 || o.getAdditionalProperties() === undefined)
        : allObjectTypes;
    const groups = Array.from(objectTypesToReplace).map(t => [t]);
    return graph.rewrite("replace object type", stringTypeMapping, false, groups, debugPrintReconstitution, replace);
}
