"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const TypeGraph_1 = require("./TypeGraph");
const Type_1 = require("./Type");
const Support_1 = require("./support/Support");
const Transformers_1 = require("./Transformers");
const TypeAttributes_1 = require("./attributes/TypeAttributes");
const StringTypes_1 = require("./attributes/StringTypes");
const Constraints_1 = require("./attributes/Constraints");
function transformationAttributes(graph, reconstitutedTargetType, transformer, debugPrintTransformations) {
    const transformation = new Transformers_1.Transformation(graph, reconstitutedTargetType, transformer);
    if (debugPrintTransformations) {
        console.log(`transformation for ${TypeGraph_1.typeRefIndex(reconstitutedTargetType)}:`);
        transformation.debugPrint();
        console.log(`reverse:`);
        transformation.reverse.debugPrint();
    }
    return Transformers_1.transformationTypeAttributeKind.makeAttributes(transformation);
}
function makeEnumTransformer(graph, enumType, stringType, continuation) {
    const sortedCases = Array.from(enumType.cases).sort();
    const caseTransformers = sortedCases.map(c => new Transformers_1.StringMatchTransformer(graph, stringType, new Transformers_1.StringProducerTransformer(graph, stringType, continuation, c), c));
    return new Transformers_1.ChoiceTransformer(graph, stringType, caseTransformers);
}
function replaceUnion(union, builder, forwardingRef, transformedTypes, debugPrintTransformations) {
    const graph = builder.typeGraph;
    Support_1.assert(union.members.size > 0, "We can't have empty unions");
    // Type attributes that we lost during reconstitution.
    let additionalAttributes = TypeAttributes_1.emptyTypeAttributes;
    function reconstituteMember(t) {
        // Special handling for some transformed string type kinds: The type in
        // the union must be the target type, so if one already exists, use that
        // one, otherwise make a new one.
        if (Type_1.isPrimitiveStringTypeKind(t.kind)) {
            const targetTypeKind = Type_1.targetTypeKindForTransformedStringTypeKind(t.kind);
            if (targetTypeKind !== undefined) {
                const targetTypeMember = union.findMember(targetTypeKind);
                additionalAttributes = TypeAttributes_1.combineTypeAttributes("union", additionalAttributes, t.getAttributes());
                if (targetTypeMember !== undefined) {
                    return builder.reconstituteType(targetTypeMember);
                }
                return builder.getPrimitiveType(targetTypeKind);
            }
        }
        return builder.reconstituteType(t);
    }
    const reconstitutedMembersByKind = collection_utils_1.mapMapEntries(union.members.entries(), m => [m.kind, reconstituteMember(m)]);
    const reconstitutedMemberSet = new Set(reconstitutedMembersByKind.values());
    const haveUnion = reconstitutedMemberSet.size > 1;
    if (!haveUnion) {
        builder.setLostTypeAttributes();
    }
    const reconstitutedTargetType = haveUnion
        ? builder.getUnionType(union.getAttributes(), reconstitutedMemberSet)
        : Support_1.defined(collection_utils_1.iterableFirst(reconstitutedMemberSet));
    function memberForKind(kind) {
        return Support_1.defined(reconstitutedMembersByKind.get(kind));
    }
    function consumer(memberTypeRef) {
        if (!haveUnion)
            return undefined;
        return new Transformers_1.UnionInstantiationTransformer(graph, memberTypeRef);
    }
    function transformerForKind(kind) {
        const member = union.findMember(kind);
        if (member === undefined)
            return undefined;
        const memberTypeRef = memberForKind(kind);
        return new Transformers_1.DecodingTransformer(graph, memberTypeRef, consumer(memberTypeRef));
    }
    let maybeStringType = undefined;
    function getStringType() {
        if (maybeStringType === undefined) {
            maybeStringType = builder.getStringType(TypeAttributes_1.emptyTypeAttributes, StringTypes_1.StringTypes.unrestricted);
        }
        return maybeStringType;
    }
    function transformerForStringType(t) {
        const memberRef = memberForKind(t.kind);
        if (t.kind === "string") {
            const minMax = Constraints_1.minMaxLengthForType(t);
            if (minMax === undefined) {
                return consumer(memberRef);
            }
            const [min, max] = minMax;
            return new Transformers_1.MinMaxLengthCheckTransformer(graph, getStringType(), consumer(memberRef), min, max);
        }
        else if (t instanceof Type_1.EnumType && transformedTypes.has(t)) {
            return makeEnumTransformer(graph, t, getStringType(), consumer(memberRef));
        }
        else {
            return new Transformers_1.ParseStringTransformer(graph, getStringType(), consumer(memberRef));
        }
    }
    const stringTypes = collection_utils_1.arraySortByInto(Array.from(union.stringTypeMembers), t => t.kind);
    let transformerForString;
    if (stringTypes.length === 0) {
        transformerForString = undefined;
    }
    else if (stringTypes.length === 1) {
        const t = stringTypes[0];
        transformerForString = new Transformers_1.DecodingTransformer(graph, getStringType(), transformerForStringType(t));
    }
    else {
        transformerForString = new Transformers_1.DecodingTransformer(graph, getStringType(), new Transformers_1.ChoiceTransformer(graph, getStringType(), stringTypes.map(t => Support_1.defined(transformerForStringType(t)))));
    }
    const transformerForClass = transformerForKind("class");
    const transformerForMap = transformerForKind("map");
    Support_1.assert(transformerForClass === undefined || transformerForMap === undefined, "Can't have both class and map in a transformed union");
    const transformerForObject = transformerForClass !== undefined ? transformerForClass : transformerForMap;
    const transformer = new Transformers_1.DecodingChoiceTransformer(graph, builder.getPrimitiveType("any"), transformerForKind("null"), transformerForKind("integer"), transformerForKind("double"), transformerForKind("bool"), transformerForString, transformerForKind("array"), transformerForObject);
    const attributes = transformationAttributes(graph, reconstitutedTargetType, transformer, debugPrintTransformations);
    return builder.getPrimitiveType("any", TypeAttributes_1.combineTypeAttributes("union", attributes, additionalAttributes), forwardingRef);
}
function replaceArray(arrayType, builder, forwardingRef, debugPrintTransformations) {
    const anyType = builder.getPrimitiveType("any");
    const anyArrayType = builder.getArrayType(TypeAttributes_1.emptyTypeAttributes, anyType);
    const reconstitutedItems = builder.reconstituteType(arrayType.items);
    const transformer = new Transformers_1.ArrayDecodingTransformer(builder.typeGraph, anyArrayType, undefined, reconstitutedItems, new Transformers_1.DecodingTransformer(builder.typeGraph, anyType, undefined));
    const reconstitutedArray = builder.getArrayType(builder.reconstituteTypeAttributes(arrayType.getAttributes()), reconstitutedItems);
    const attributes = transformationAttributes(builder.typeGraph, reconstitutedArray, transformer, debugPrintTransformations);
    return builder.getArrayType(attributes, anyType, forwardingRef);
}
function replaceEnum(enumType, builder, forwardingRef, debugPrintTransformations) {
    const stringType = builder.getStringType(TypeAttributes_1.emptyTypeAttributes, StringTypes_1.StringTypes.unrestricted);
    const transformer = new Transformers_1.DecodingTransformer(builder.typeGraph, stringType, makeEnumTransformer(builder.typeGraph, enumType, stringType));
    const reconstitutedEnum = builder.getEnumType(enumType.getAttributes(), enumType.cases);
    const attributes = transformationAttributes(builder.typeGraph, reconstitutedEnum, transformer, debugPrintTransformations);
    return builder.getStringType(attributes, StringTypes_1.StringTypes.unrestricted, forwardingRef);
}
function replaceNumber(t, builder, forwardingRef, debugPrintTransformations) {
    const stringType = builder.getStringType(TypeAttributes_1.emptyTypeAttributes, StringTypes_1.StringTypes.unrestricted);
    const [min, max] = Support_1.defined(Constraints_1.minMaxValueForType(t));
    const transformer = new Transformers_1.DecodingTransformer(builder.typeGraph, stringType, new Transformers_1.MinMaxValueTransformer(builder.typeGraph, stringType, undefined, min, max));
    const reconstitutedAttributes = builder.reconstituteTypeAttributes(t.getAttributes());
    const attributes = transformationAttributes(builder.typeGraph, builder.getPrimitiveType("double", reconstitutedAttributes, undefined), transformer, debugPrintTransformations);
    return builder.getPrimitiveType("double", attributes, forwardingRef);
}
function replaceString(t, builder, forwardingRef, debugPrintTransformations) {
    const [min, max] = Support_1.defined(Constraints_1.minMaxLengthForType(t));
    const reconstitutedAttributes = builder.reconstituteTypeAttributes(t.getAttributes());
    const stringType = builder.getStringType(TypeAttributes_1.emptyTypeAttributes, StringTypes_1.StringTypes.unrestricted);
    const transformer = new Transformers_1.DecodingTransformer(builder.typeGraph, stringType, new Transformers_1.MinMaxLengthCheckTransformer(builder.typeGraph, stringType, undefined, min, max));
    const attributes = transformationAttributes(builder.typeGraph, builder.getStringType(reconstitutedAttributes, undefined), transformer, debugPrintTransformations);
    return builder.getStringType(attributes, StringTypes_1.StringTypes.unrestricted, forwardingRef);
}
function replaceTransformedStringType(t, kind, builder, forwardingRef, debugPrintTransformations) {
    const reconstitutedAttributes = builder.reconstituteTypeAttributes(t.getAttributes());
    const targetTypeKind = collection_utils_1.withDefault(Type_1.targetTypeKindForTransformedStringTypeKind(kind), kind);
    const stringType = builder.getStringType(TypeAttributes_1.emptyTypeAttributes, StringTypes_1.StringTypes.unrestricted);
    const transformer = new Transformers_1.DecodingTransformer(builder.typeGraph, stringType, new Transformers_1.ParseStringTransformer(builder.typeGraph, stringType, undefined));
    const attributes = transformationAttributes(builder.typeGraph, builder.getPrimitiveType(targetTypeKind, reconstitutedAttributes), transformer, debugPrintTransformations);
    return builder.getStringType(attributes, StringTypes_1.StringTypes.unrestricted, forwardingRef);
}
function makeTransformations(ctx, graph, targetLanguage) {
    const transformedTypes = collection_utils_1.setFilter(graph.allTypesUnordered(), t => {
        if (targetLanguage.needsTransformerForType(t))
            return true;
        if (!(t instanceof Type_1.UnionType))
            return false;
        const stringMembers = t.stringTypeMembers;
        if (stringMembers.size <= 1)
            return false;
        return collection_utils_1.iterableSome(stringMembers, m => targetLanguage.needsTransformerForType(m));
    });
    function replace(setOfOneUnion, builder, forwardingRef) {
        const t = Support_1.defined(collection_utils_1.iterableFirst(setOfOneUnion));
        if (t instanceof Type_1.UnionType) {
            return replaceUnion(t, builder, forwardingRef, transformedTypes, ctx.debugPrintTransformations);
        }
        if (t instanceof Type_1.ArrayType) {
            return replaceArray(t, builder, forwardingRef, ctx.debugPrintTransformations);
        }
        if (t instanceof Type_1.EnumType) {
            return replaceEnum(t, builder, forwardingRef, ctx.debugPrintTransformations);
        }
        if (t.kind === "string") {
            return replaceString(t, builder, forwardingRef, ctx.debugPrintTransformations);
        }
        if (Type_1.isNumberTypeKind(t.kind)) {
            return replaceNumber(t, builder, forwardingRef, ctx.debugPrintTransformations);
        }
        if (Type_1.isPrimitiveStringTypeKind(t.kind)) {
            return replaceTransformedStringType(t, t.kind, builder, forwardingRef, ctx.debugPrintTransformations);
        }
        return Support_1.panic(`Cannot make transformation for type ${t.kind}`);
    }
    const groups = Array.from(transformedTypes).map(t => [t]);
    return graph.rewrite("make-transformations", ctx.stringTypeMapping, false, groups, ctx.debugPrintReconstitution, replace);
}
exports.makeTransformations = makeTransformations;
