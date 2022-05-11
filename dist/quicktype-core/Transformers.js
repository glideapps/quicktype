"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const collection_utils_1 = require("collection-utils");
const Type_1 = require("./Type");
const TypeAttributes_1 = require("./attributes/TypeAttributes");
const Support_1 = require("./support/Support");
const TypeGraph_1 = require("./TypeGraph");
function debugStringForType(t) {
    const target = followTargetType(t);
    if (t === target) {
        return t.kind;
    }
    return `${t.kind} (${target.kind})`;
}
function getNumberOfNodes(xfer) {
    return collection_utils_1.definedMapWithDefault(xfer, 0, x => x.getNumberOfNodes());
}
class Transformer {
    constructor(kind, graph, sourceTypeRef) {
        this.kind = kind;
        this.graph = graph;
        this.sourceTypeRef = sourceTypeRef;
    }
    get sourceType() {
        return TypeGraph_1.derefTypeRef(this.sourceTypeRef, this.graph);
    }
    /** This must return a newly constructed set. */
    getChildren() {
        return new Set([this.sourceType]);
    }
    getNumberOfNodes() {
        return 1;
    }
    equals(other) {
        if (!(other instanceof Transformer))
            return false;
        return this.sourceTypeRef === other.sourceTypeRef;
    }
    hashCode() {
        return collection_utils_1.hashCodeOf(this.sourceTypeRef);
    }
    debugDescription() {
        return `${debugStringForType(this.sourceType)} -> ${this.kind}`;
    }
    debugPrintContinuations(_indent) {
        return;
    }
    debugPrint(indent) {
        console.log(Support_1.indentationString(indent) + this.debugDescription());
        this.debugPrintContinuations(indent + 1);
    }
}
exports.Transformer = Transformer;
class ProducerTransformer extends Transformer {
    constructor(kind, graph, sourceTypeRef, consumer) {
        super(kind, graph, sourceTypeRef);
        this.consumer = consumer;
    }
    getChildren() {
        const children = super.getChildren();
        if (this.consumer === undefined)
            return children;
        return collection_utils_1.setUnionInto(children, this.consumer.getChildren());
    }
    getNumberOfNodes() {
        return super.getNumberOfNodes() + getNumberOfNodes(this.consumer);
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        if (!(other instanceof ProducerTransformer))
            return false;
        return collection_utils_1.areEqual(this.consumer, other.consumer);
    }
    hashCode() {
        const h = super.hashCode();
        return collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.consumer));
    }
    debugPrintContinuations(indent) {
        if (this.consumer === undefined)
            return;
        this.consumer.debugPrint(indent);
    }
}
exports.ProducerTransformer = ProducerTransformer;
class MatchTransformer extends Transformer {
    constructor(kind, graph, sourceTypeRef, transformer) {
        super(kind, graph, sourceTypeRef);
        this.transformer = transformer;
    }
    getChildren() {
        return collection_utils_1.setUnionInto(super.getChildren(), this.transformer.getChildren());
    }
    getNumberOfNodes() {
        return super.getNumberOfNodes() + this.transformer.getNumberOfNodes();
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        if (!(other instanceof MatchTransformer))
            return false;
        return this.transformer.equals(other.transformer);
    }
    hashCode() {
        const h = super.hashCode();
        return collection_utils_1.addHashCode(h, this.transformer.hashCode());
    }
    debugPrintContinuations(indent) {
        this.transformer.debugPrint(indent);
    }
}
exports.MatchTransformer = MatchTransformer;
class DecodingTransformer extends ProducerTransformer {
    constructor(graph, sourceTypeRef, consumer) {
        super("decode", graph, sourceTypeRef, consumer);
    }
    get canFail() {
        return false;
    }
    reverse(targetTypeRef, continuationTransformer) {
        if (continuationTransformer !== undefined) {
            return Support_1.panic("Reversing a decoding transformer cannot have a continuation");
        }
        if (this.consumer === undefined) {
            return new EncodingTransformer(this.graph, targetTypeRef);
        }
        else {
            return this.consumer.reverse(targetTypeRef, new EncodingTransformer(this.graph, this.consumer.sourceTypeRef));
        }
    }
    reconstitute(builder) {
        return new DecodingTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), collection_utils_1.definedMap(this.consumer, xfer => xfer.reconstitute(builder)));
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        return other instanceof DecodingTransformer;
    }
}
exports.DecodingTransformer = DecodingTransformer;
class EncodingTransformer extends Transformer {
    constructor(graph, sourceTypeRef) {
        super("encode", graph, sourceTypeRef);
    }
    get canFail() {
        return false;
    }
    reverse(_targetTypeRef, _continuationTransformer) {
        return Support_1.panic("Can't reverse encoding transformer");
    }
    reconstitute(builder) {
        return new EncodingTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef));
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        if (!(other instanceof EncodingTransformer))
            return false;
        return true;
    }
}
exports.EncodingTransformer = EncodingTransformer;
class ArrayDecodingTransformer extends ProducerTransformer {
    constructor(graph, sourceTypeRef, consumer, _itemTargetTypeRef, itemTransformer) {
        super("decode-array", graph, sourceTypeRef, consumer);
        this._itemTargetTypeRef = _itemTargetTypeRef;
        this.itemTransformer = itemTransformer;
    }
    getChildren() {
        const children = super.getChildren();
        children.add(this.itemTargetType);
        return collection_utils_1.setUnionInto(children, this.itemTransformer.getChildren());
    }
    getNumberOfNodes() {
        return super.getNumberOfNodes() + this.itemTransformer.getNumberOfNodes();
    }
    get canFail() {
        return false;
    }
    get itemTargetType() {
        return TypeGraph_1.derefTypeRef(this._itemTargetTypeRef, this.graph);
    }
    reverse(targetTypeRef, continuationTransformer) {
        if (continuationTransformer !== undefined) {
            return Support_1.panic("Reversing a decoding transformer cannot have a continuation");
        }
        const itemTransformer = this.itemTransformer.reverse(this._itemTargetTypeRef, undefined);
        if (this.consumer === undefined) {
            return new ArrayEncodingTransformer(this.graph, targetTypeRef, this.itemTransformer.sourceTypeRef, itemTransformer);
        }
        else {
            return this.consumer.reverse(targetTypeRef, new ArrayEncodingTransformer(this.graph, this.consumer.sourceTypeRef, this.itemTransformer.sourceTypeRef, itemTransformer));
        }
    }
    reconstitute(builder) {
        return new ArrayDecodingTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), collection_utils_1.definedMap(this.consumer, xfer => xfer.reconstitute(builder)), builder.reconstituteTypeRef(this._itemTargetTypeRef), this.itemTransformer.reconstitute(builder));
    }
    hashCode() {
        let h = super.hashCode();
        h = collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this._itemTargetTypeRef));
        h = collection_utils_1.addHashCode(h, this.itemTransformer.hashCode());
        return h;
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        if (!(other instanceof ArrayDecodingTransformer))
            return false;
        if (!collection_utils_1.areEqual(this._itemTargetTypeRef, other._itemTargetTypeRef))
            return false;
        return this.itemTransformer.equals(other.itemTransformer);
    }
    debugPrintContinuations(indent) {
        this.itemTransformer.debugPrint(indent);
        super.debugPrintContinuations(indent);
    }
}
exports.ArrayDecodingTransformer = ArrayDecodingTransformer;
class ArrayEncodingTransformer extends Transformer {
    constructor(graph, sourceTypeRef, _itemTargetTypeRef, itemTransformer) {
        super("encode-array", graph, sourceTypeRef);
        this._itemTargetTypeRef = _itemTargetTypeRef;
        this.itemTransformer = itemTransformer;
    }
    getChildren() {
        const children = super.getChildren();
        children.add(this.itemTargetType);
        return collection_utils_1.setUnionInto(children, this.itemTransformer.getChildren());
    }
    getNumberOfNodes() {
        return super.getNumberOfNodes() + this.itemTransformer.getNumberOfNodes();
    }
    get canFail() {
        return false;
    }
    get itemTargetType() {
        return TypeGraph_1.derefTypeRef(this._itemTargetTypeRef, this.graph);
    }
    reverse(_targetTypeRef, _continuationTransformer) {
        return Support_1.panic("Can't reverse array encoding transformer");
    }
    reconstitute(builder) {
        return new ArrayEncodingTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), builder.reconstituteTypeRef(this._itemTargetTypeRef), this.itemTransformer.reconstitute(builder));
    }
    hashCode() {
        let h = super.hashCode();
        h = collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this._itemTargetTypeRef));
        return collection_utils_1.addHashCode(h, this.itemTransformer.hashCode());
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        if (!(other instanceof ArrayEncodingTransformer))
            return false;
        if (!collection_utils_1.areEqual(this._itemTargetTypeRef, other._itemTargetTypeRef))
            return false;
        return this.itemTransformer.equals(other.itemTransformer);
    }
    debugPrintContinuations(indent) {
        this.itemTransformer.debugPrint(indent);
        super.debugPrintContinuations(indent);
    }
}
exports.ArrayEncodingTransformer = ArrayEncodingTransformer;
class ChoiceTransformer extends Transformer {
    constructor(graph, sourceTypeRef, transformers) {
        super("choice", graph, sourceTypeRef);
        this.transformers = transformers;
        Support_1.assert(transformers.length > 0, "Choice must have at least one transformer");
    }
    getChildren() {
        let children = super.getChildren();
        for (const xfer of this.transformers) {
            collection_utils_1.setUnionInto(children, xfer.getChildren());
        }
        return children;
    }
    getNumberOfNodes() {
        let n = 0;
        for (const xfer of this.transformers) {
            n += xfer.getNumberOfNodes();
        }
        return super.getNumberOfNodes() + n;
    }
    get canFail() {
        return this.transformers.some(xfer => xfer.canFail);
    }
    reverse(targetTypeRef, continuationTransformer) {
        const transformers = this.transformers.map(xfer => xfer.reverse(targetTypeRef, continuationTransformer));
        if (transformers.every(xfer => xfer instanceof UnionMemberMatchTransformer)) {
            const memberMatchers = transformers;
            const first = memberMatchers[0];
            if (memberMatchers.every(xfer => first.memberType.equals(xfer.memberType))) {
                const subTransformers = memberMatchers.map(xfer => xfer.transformer);
                return new UnionMemberMatchTransformer(this.graph, targetTypeRef, new ChoiceTransformer(this.graph, subTransformers[0].sourceTypeRef, subTransformers), first.memberTypeRef);
            }
        }
        return new ChoiceTransformer(this.graph, targetTypeRef, transformers);
    }
    reconstitute(builder) {
        return new ChoiceTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), this.transformers.map(xfer => xfer.reconstitute(builder)));
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        if (!(other instanceof ChoiceTransformer))
            return false;
        return collection_utils_1.areEqual(this.transformers, other.transformers);
    }
    hashCode() {
        const h = super.hashCode();
        return collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.transformers));
    }
    debugPrintContinuations(indent) {
        for (const xfer of this.transformers) {
            xfer.debugPrint(indent);
        }
    }
}
exports.ChoiceTransformer = ChoiceTransformer;
class DecodingChoiceTransformer extends Transformer {
    constructor(graph, sourceTypeRef, nullTransformer, integerTransformer, doubleTransformer, boolTransformer, stringTransformer, arrayTransformer, objectTransformer) {
        super("decoding-choice", graph, sourceTypeRef);
        this.nullTransformer = nullTransformer;
        this.integerTransformer = integerTransformer;
        this.doubleTransformer = doubleTransformer;
        this.boolTransformer = boolTransformer;
        this.stringTransformer = stringTransformer;
        this.arrayTransformer = arrayTransformer;
        this.objectTransformer = objectTransformer;
    }
    get transformers() {
        const transformers = [];
        function add(xfer) {
            if (xfer === undefined)
                return;
            transformers.push(xfer);
        }
        add(this.nullTransformer);
        add(this.integerTransformer);
        add(this.doubleTransformer);
        add(this.boolTransformer);
        add(this.stringTransformer);
        add(this.arrayTransformer);
        add(this.objectTransformer);
        return transformers;
    }
    getChildren() {
        let children = super.getChildren();
        for (const xfer of this.transformers) {
            collection_utils_1.setUnionInto(children, xfer.getChildren());
        }
        return children;
    }
    getNumberOfNodes() {
        let n = super.getNumberOfNodes();
        for (const xfer of this.transformers) {
            n += getNumberOfNodes(xfer);
        }
        return n;
    }
    get canFail() {
        return false;
    }
    reverse(targetTypeRef, continuationTransformer) {
        Support_1.assert(continuationTransformer === undefined, "Reversing a decoding transformer can't have a target transformer");
        let transformers = new Map();
        let memberMatchTransformers = new Map();
        function addCase(reversed) {
            if (reversed instanceof UnionMemberMatchTransformer) {
                const memberType = reversed.memberType;
                let arr = memberMatchTransformers.get(memberType);
                if (arr === undefined) {
                    arr = [];
                    memberMatchTransformers.set(memberType, arr);
                }
                arr.push(reversed);
            }
            else {
                const kind = reversed.sourceType.kind;
                let arr = transformers.get(kind);
                if (arr === undefined) {
                    arr = [];
                    transformers.set(kind, arr);
                }
                arr.push(reversed);
            }
        }
        function reverseAndAdd(transformer) {
            const reversed = transformer.reverse(targetTypeRef, undefined);
            let cases = [];
            // Flatten nested ChoiceTransformers
            if (reversed instanceof ChoiceTransformer) {
                cases = reversed.transformers;
            }
            else {
                cases = [reversed];
            }
            for (const xfer of cases) {
                addCase(xfer);
            }
        }
        // FIXME: Actually, keep all the failing transformers and put them first, then
        // finally do the simplest non-failing one.  Actually actually, maybe not, since
        // we're reversing to encode?  What's a case where this would be useful?
        // If there are non-failing transformers, we ignore the ones that can fail and
        // just pick the "simplest" non-failing one, being the one with the least number
        // of nodes.
        function filter(xfers) {
            Support_1.assert(xfers.length > 0, "Must have at least one transformer");
            const nonfailing = xfers.filter(xfer => {
                // For member match transformers we're deciding between
                // multiple that match against the same member, so the fact
                // that the match can fail is not important, since if it fails
                // it will fail for all candidates.  The question is whether
                // its continuation can fail.
                if (xfer instanceof UnionMemberMatchTransformer) {
                    return !xfer.transformer.canFail;
                }
                else {
                    return !xfer.canFail;
                }
            });
            if (nonfailing.length === 0)
                return xfers;
            const smallest = collection_utils_1.arraySortByInto(nonfailing.map(x => [x.getNumberOfNodes(), x]), ([c, _]) => c)[0][1];
            return [smallest];
        }
        this.transformers.forEach(reverseAndAdd);
        const allTransformers = Array.from(transformers.values()).concat(Array.from(memberMatchTransformers.values()));
        const resultingTransformers = [].concat(...allTransformers.map(filter));
        // No choice needed if there's only one
        if (resultingTransformers.length === 1) {
            return resultingTransformers[0];
        }
        return new ChoiceTransformer(this.graph, targetTypeRef, resultingTransformers);
    }
    reconstitute(builder) {
        function reconstitute(xf) {
            if (xf === undefined)
                return undefined;
            return xf.reconstitute(builder);
        }
        return new DecodingChoiceTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), reconstitute(this.nullTransformer), reconstitute(this.integerTransformer), reconstitute(this.doubleTransformer), reconstitute(this.boolTransformer), reconstitute(this.stringTransformer), reconstitute(this.arrayTransformer), reconstitute(this.objectTransformer));
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        if (!(other instanceof DecodingChoiceTransformer))
            return false;
        if (!collection_utils_1.areEqual(this.nullTransformer, other.nullTransformer))
            return false;
        if (!collection_utils_1.areEqual(this.integerTransformer, other.integerTransformer))
            return false;
        if (!collection_utils_1.areEqual(this.doubleTransformer, other.doubleTransformer))
            return false;
        if (!collection_utils_1.areEqual(this.boolTransformer, other.boolTransformer))
            return false;
        if (!collection_utils_1.areEqual(this.stringTransformer, other.stringTransformer))
            return false;
        if (!collection_utils_1.areEqual(this.arrayTransformer, other.arrayTransformer))
            return false;
        if (!collection_utils_1.areEqual(this.objectTransformer, other.objectTransformer))
            return false;
        return true;
    }
    hashCode() {
        let h = super.hashCode();
        h = collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.nullTransformer));
        h = collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.integerTransformer));
        h = collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.doubleTransformer));
        h = collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.boolTransformer));
        h = collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.stringTransformer));
        h = collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.arrayTransformer));
        h = collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.objectTransformer));
        return h;
    }
    debugPrintContinuations(indent) {
        for (const xfer of this.transformers) {
            xfer.debugPrint(indent);
        }
    }
}
exports.DecodingChoiceTransformer = DecodingChoiceTransformer;
class UnionMemberMatchTransformer extends MatchTransformer {
    constructor(graph, sourceTypeRef, transformer, memberTypeRef) {
        super("union-member-match", graph, sourceTypeRef, transformer);
        this.memberTypeRef = memberTypeRef;
    }
    get sourceType() {
        const t = TypeGraph_1.derefTypeRef(this.sourceTypeRef, this.graph);
        if (!(t instanceof Type_1.UnionType)) {
            return Support_1.panic("The source of a union member match transformer must be a union type");
        }
        return t;
    }
    get canFail() {
        return true;
    }
    get memberType() {
        return TypeGraph_1.derefTypeRef(this.memberTypeRef, this.graph);
    }
    getChildren() {
        return super.getChildren().add(this.memberType);
    }
    reverse(_targetTypeRef, _continuationTransformer) {
        return Support_1.panic("Can't reverse union member match transformer");
    }
    reconstitute(builder) {
        return new UnionMemberMatchTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), this.transformer.reconstitute(builder), builder.reconstituteTypeRef(this.memberTypeRef));
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        if (!(other instanceof UnionMemberMatchTransformer))
            return false;
        return this.memberTypeRef === other.memberTypeRef;
    }
    hashCode() {
        const h = super.hashCode();
        return collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.memberTypeRef));
    }
    debugDescription() {
        return `${super.debugDescription()} - member: ${debugStringForType(this.memberType)}`;
    }
}
exports.UnionMemberMatchTransformer = UnionMemberMatchTransformer;
/**
 * This matches strings and enum cases.
 */
class StringMatchTransformer extends MatchTransformer {
    constructor(graph, sourceTypeRef, transformer, stringCase) {
        super("string-match", graph, sourceTypeRef, transformer);
        this.stringCase = stringCase;
    }
    get sourceType() {
        const t = TypeGraph_1.derefTypeRef(this.sourceTypeRef, this.graph);
        if (!(t instanceof Type_1.EnumType) && !(t instanceof Type_1.PrimitiveType && t.kind === "string")) {
            return Support_1.panic("The source of a string match transformer must be an enum or string type");
        }
        return t;
    }
    get canFail() {
        return true;
    }
    reverse(targetTypeRef, continuationTransformer) {
        return this.transformer.reverse(targetTypeRef, new StringProducerTransformer(this.graph, this.transformer.sourceTypeRef, continuationTransformer, this.stringCase));
    }
    reconstitute(builder) {
        return new StringMatchTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), this.transformer.reconstitute(builder), this.stringCase);
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        if (!(other instanceof StringMatchTransformer))
            return false;
        return this.stringCase !== other.stringCase;
    }
    hashCode() {
        const h = super.hashCode();
        return collection_utils_1.addHashCode(h, collection_utils_1.hashString(this.stringCase));
    }
    debugDescription() {
        return `${super.debugDescription()} - case: ${this.stringCase}`;
    }
}
exports.StringMatchTransformer = StringMatchTransformer;
class UnionInstantiationTransformer extends Transformer {
    constructor(graph, sourceTypeRef) {
        super("union-instantiation", graph, sourceTypeRef);
    }
    get canFail() {
        return false;
    }
    reverse(targetTypeRef, continuationTransformer) {
        if (continuationTransformer === undefined) {
            return Support_1.panic("Union instantiation transformer reverse must have a continuation");
        }
        return new UnionMemberMatchTransformer(this.graph, targetTypeRef, continuationTransformer, this.sourceTypeRef);
    }
    reconstitute(builder) {
        return new UnionInstantiationTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef));
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        return other instanceof UnionInstantiationTransformer;
    }
}
exports.UnionInstantiationTransformer = UnionInstantiationTransformer;
/**
 * Produces a string or an enum case.
 */
class StringProducerTransformer extends ProducerTransformer {
    constructor(graph, sourceTypeRef, consumer, result) {
        super("string-producer", graph, sourceTypeRef, consumer);
        this.result = result;
    }
    get canFail() {
        return false;
    }
    reverse(targetTypeRef, continuationTransformer) {
        if (continuationTransformer === undefined) {
            return Support_1.panic("Reversing a string producer transformer must have a continuation");
        }
        if (this.consumer === undefined) {
            return new StringMatchTransformer(this.graph, targetTypeRef, continuationTransformer, this.result);
        }
        else {
            return this.consumer.reverse(targetTypeRef, new StringMatchTransformer(this.graph, this.consumer.sourceTypeRef, continuationTransformer, this.result));
        }
    }
    reconstitute(builder) {
        return new StringProducerTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), collection_utils_1.definedMap(this.consumer, xfer => xfer.reconstitute(builder)), this.result);
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        if (!(other instanceof StringProducerTransformer))
            return false;
        return this.result === other.result;
    }
    hashCode() {
        const h = super.hashCode();
        return collection_utils_1.addHashCode(h, collection_utils_1.hashCodeOf(this.consumer));
    }
    debugDescription() {
        return `${super.debugDescription()} - result: ${this.result}`;
    }
}
exports.StringProducerTransformer = StringProducerTransformer;
class ParseStringTransformer extends ProducerTransformer {
    constructor(graph, sourceTypeRef, consumer) {
        super("parse-string", graph, sourceTypeRef, consumer);
    }
    get canFail() {
        return true;
    }
    reverse(targetTypeRef, continuationTransformer) {
        if (this.consumer === undefined) {
            return new StringifyTransformer(this.graph, targetTypeRef, continuationTransformer);
        }
        else {
            return this.consumer.reverse(targetTypeRef, new StringifyTransformer(this.graph, this.consumer.sourceTypeRef, continuationTransformer));
        }
    }
    reconstitute(builder) {
        return new ParseStringTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), collection_utils_1.definedMap(this.consumer, xfer => xfer.reconstitute(builder)));
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        return other instanceof ParseStringTransformer;
    }
}
exports.ParseStringTransformer = ParseStringTransformer;
class StringifyTransformer extends ProducerTransformer {
    constructor(graph, sourceTypeRef, consumer) {
        super("stringify", graph, sourceTypeRef, consumer);
    }
    get canFail() {
        return false;
    }
    reverse(targetTypeRef, continuationTransformer) {
        if (this.consumer === undefined) {
            return new ParseStringTransformer(this.graph, targetTypeRef, continuationTransformer);
        }
        else {
            return this.consumer.reverse(targetTypeRef, new ParseStringTransformer(this.graph, this.consumer.sourceTypeRef, continuationTransformer));
        }
    }
    reconstitute(builder) {
        return new StringifyTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), collection_utils_1.definedMap(this.consumer, xfer => xfer.reconstitute(builder)));
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        return other instanceof StringifyTransformer;
    }
}
exports.StringifyTransformer = StringifyTransformer;
class MinMaxLengthCheckTransformer extends ProducerTransformer {
    constructor(graph, sourceTypeRef, consumer, minLength, maxLength) {
        super("min-max-length-check", graph, sourceTypeRef, consumer);
        this.minLength = minLength;
        this.maxLength = maxLength;
    }
    get canFail() {
        return true;
    }
    reverse(targetTypeRef, continuationTransformer) {
        if (this.consumer === undefined) {
            return new MinMaxLengthCheckTransformer(this.graph, targetTypeRef, continuationTransformer, this.minLength, this.maxLength);
        }
        else {
            return this.consumer.reverse(targetTypeRef, new MinMaxLengthCheckTransformer(this.graph, this.consumer.sourceTypeRef, continuationTransformer, this.minLength, this.maxLength));
        }
    }
    reconstitute(builder) {
        return new MinMaxLengthCheckTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), collection_utils_1.definedMap(this.consumer, xfer => xfer.reconstitute(builder)), this.minLength, this.maxLength);
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        return (other instanceof MinMaxLengthCheckTransformer &&
            this.minLength === other.minLength &&
            this.maxLength === other.maxLength);
    }
}
exports.MinMaxLengthCheckTransformer = MinMaxLengthCheckTransformer;
class MinMaxValueTransformer extends ProducerTransformer {
    constructor(graph, sourceTypeRef, consumer, minimum, maximum) {
        super("min-max-value-check", graph, sourceTypeRef, consumer);
        this.minimum = minimum;
        this.maximum = maximum;
    }
    get canFail() {
        return true;
    }
    reverse(targetTypeRef, continuationTransformer) {
        if (this.consumer === undefined) {
            return new MinMaxValueTransformer(this.graph, targetTypeRef, continuationTransformer, this.minimum, this.maximum);
        }
        else {
            return this.consumer.reverse(targetTypeRef, new MinMaxValueTransformer(this.graph, this.consumer.sourceTypeRef, continuationTransformer, this.minimum, this.maximum));
        }
    }
    reconstitute(builder) {
        return new MinMaxValueTransformer(builder.typeGraph, builder.reconstituteTypeRef(this.sourceTypeRef), collection_utils_1.definedMap(this.consumer, xfer => xfer.reconstitute(builder)), this.minimum, this.maximum);
    }
    equals(other) {
        if (!super.equals(other))
            return false;
        return (other instanceof MinMaxValueTransformer &&
            this.minimum === other.minimum &&
            this.maximum === other.maximum);
    }
}
exports.MinMaxValueTransformer = MinMaxValueTransformer;
class Transformation {
    constructor(_graph, _targetTypeRef, transformer) {
        this._graph = _graph;
        this._targetTypeRef = _targetTypeRef;
        this.transformer = transformer;
    }
    get sourceType() {
        return this.transformer.sourceType;
    }
    get targetType() {
        return TypeGraph_1.derefTypeRef(this._targetTypeRef, this._graph);
    }
    get reverse() {
        return new Transformation(this._graph, this.transformer.sourceTypeRef, this.transformer.reverse(this._targetTypeRef, undefined));
    }
    getChildren() {
        return this.transformer.getChildren().add(this.targetType);
    }
    reconstitute(builder) {
        return new Transformation(builder.typeGraph, builder.reconstituteTypeRef(this._targetTypeRef), this.transformer.reconstitute(builder));
    }
    equals(other) {
        if (!(other instanceof Transformation))
            return false;
        return this._targetTypeRef === other._targetTypeRef && this.transformer.equals(other.transformer);
    }
    hashCode() {
        let h = collection_utils_1.hashCodeOf(this._targetTypeRef);
        h = collection_utils_1.addHashCode(h, this.transformer.hashCode());
        return h;
    }
    debugPrint() {
        this.transformer.debugPrint(0);
        console.log(`-> ${debugStringForType(this.targetType)}`);
    }
}
exports.Transformation = Transformation;
class TransformationTypeAttributeKind extends TypeAttributes_1.TypeAttributeKind {
    constructor() {
        super("transformation");
    }
    appliesToTypeKind(_kind) {
        return true;
    }
    get inIdentity() {
        return true;
    }
    children(xf) {
        return xf.getChildren();
    }
    reconstitute(builder, xf) {
        return xf.reconstitute(builder);
    }
    stringify(_) {
        return "transformation";
    }
}
exports.transformationTypeAttributeKind = new TransformationTypeAttributeKind();
function transformationForType(t) {
    return exports.transformationTypeAttributeKind.tryGetInAttributes(t.getAttributes());
}
exports.transformationForType = transformationForType;
function followTargetType(t) {
    for (;;) {
        const xf = transformationForType(t);
        if (xf === undefined)
            return t;
        t = xf.targetType;
    }
}
exports.followTargetType = followTargetType;
