"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Support_1 = require("../support/Support");
const TypeAttributes_1 = require("../attributes/TypeAttributes");
function replaceObjectType(graph, stringTypeMapping, _conflateNumbers, leaveFullObjects, debugPrintReconstitution) {
    function replace(setOfOneType, builder, forwardingRef) {
        const o = Support_1.defined(collection_utils_1.iterableFirst(setOfOneType));
        const attributes = o.getAttributes();
        const properties = o.getProperties();
        const additionalProperties = o.getAdditionalProperties();
        function reconstituteProperties() {
            return collection_utils_1.mapMap(properties, cp => builder.makeClassProperty(builder.reconstituteTypeRef(cp.typeRef), cp.isOptional));
        }
        function makeClass() {
            return builder.getUniqueClassType(attributes, true, reconstituteProperties(), forwardingRef);
        }
        function reconstituteAdditionalProperties() {
            return builder.reconstituteType(Support_1.defined(additionalProperties));
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
        const propertyTypes = collection_utils_1.setMap(properties.values(), cp => cp.type).add(additionalProperties);
        let union = builder.lookupTypeRefs(Array.from(propertyTypes).map(t => t.typeRef));
        if (union === undefined) {
            const reconstitutedTypes = collection_utils_1.setMap(propertyTypes, t => builder.reconstituteType(t));
            union = builder.getUniqueUnionType(TypeAttributes_1.emptyTypeAttributes, new Set(reconstitutedTypes));
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
    const allObjectTypes = collection_utils_1.setFilter(graph.allTypesUnordered(), t => t.kind === "object");
    const objectTypesToReplace = leaveFullObjects
        ? collection_utils_1.setFilter(allObjectTypes, o => o.getProperties().size === 0 || o.getAdditionalProperties() === undefined)
        : allObjectTypes;
    const groups = Array.from(objectTypesToReplace).map(t => [t]);
    return graph.rewrite("replace object type", stringTypeMapping, false, groups, debugPrintReconstitution, replace);
}
exports.replaceObjectType = replaceObjectType;
