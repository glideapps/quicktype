"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TypeGraph_1 = require("../TypeGraph");
const Type_1 = require("../Type");
const TypeUtils_1 = require("../TypeUtils");
const Support_1 = require("../support/Support");
const UnifyClasses_1 = require("../UnifyClasses");
const Messages_1 = require("../Messages");
const TypeAttributes_1 = require("../attributes/TypeAttributes");
function flattenUnions(graph, stringTypeMapping, conflateNumbers, makeObjectTypes, debugPrintReconstitution) {
    let needsRepeat = false;
    function replace(types, builder, forwardingRef) {
        const unionBuilder = new UnifyClasses_1.UnifyUnionBuilder(builder, makeObjectTypes, true, trefs => {
            Support_1.assert(trefs.length > 0, "Must have at least one type to build union");
            trefs = trefs.map(tref => builder.reconstituteType(TypeGraph_1.derefTypeRef(tref, graph)));
            if (trefs.length === 1) {
                return trefs[0];
            }
            needsRepeat = true;
            return builder.getUnionType(TypeAttributes_1.emptyTypeAttributes, new Set(trefs));
        });
        return UnifyClasses_1.unifyTypes(types, TypeAttributes_1.emptyTypeAttributes, builder, unionBuilder, conflateNumbers, forwardingRef);
    }
    const allUnions = collection_utils_1.setFilter(graph.allTypesUnordered(), t => t instanceof Type_1.UnionType);
    const nonCanonicalUnions = collection_utils_1.setFilter(allUnions, u => !u.isCanonical);
    let foundIntersection = false;
    const groups = TypeUtils_1.makeGroupsToFlatten(nonCanonicalUnions, members => {
        Messages_1.messageAssert(members.size > 0, "IRNoEmptyUnions", {});
        if (!collection_utils_1.iterableSome(members, m => m instanceof Type_1.IntersectionType))
            return true;
        // FIXME: This is stupid.  `flattenUnions` returns true when no more union
        // flattening is necessary, but `resolveIntersections` can introduce new
        // unions that might require flattening, so now `flattenUnions` needs to take
        // that into account.  Either change `resolveIntersections` such that it
        // doesn't introduce non-canonical unions (by using `unifyTypes`), or have
        // some other way to tell whether more work is needed that doesn't require
        // the two passes to know about each other.
        foundIntersection = true;
        return false;
    });
    graph = graph.rewrite("flatten unions", stringTypeMapping, false, groups, debugPrintReconstitution, replace);
    // console.log(`flattened ${nonCanonicalUnions.size} of ${unions.size} unions`);
    return [graph, !needsRepeat && !foundIntersection];
}
exports.flattenUnions = flattenUnions;
