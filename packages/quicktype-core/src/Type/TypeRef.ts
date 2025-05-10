import { type TypeAttributes } from "../attributes/TypeAttributes";
import { type BaseGraphRewriteBuilder } from "../GraphRewriting";
import { assert } from "../support/Support";

import { type Type } from "./Type";
import { TypeGraph } from "./TypeGraph";

const indexBits = 26;
const indexMask = (1 << indexBits) - 1;
const serialBits = 31 - indexBits;
const serialMask = (1 << serialBits) - 1;

export type TypeRef = number;

export function isTypeRef(x: unknown): x is TypeRef {
    return typeof x === "number";
}

export function makeTypeRef(graph: TypeGraph, index: number): TypeRef {
    assert(index <= indexMask, "Too many types in graph");
    return ((graph.serial & serialMask) << indexBits) | index;
}

export function typeRefIndex(tref: TypeRef): number {
    return tref & indexMask;
}

export function assertTypeRefGraph(tref: TypeRef, graph: TypeGraph): void {
    assert(
        ((tref >> indexBits) & serialMask) === (graph.serial & serialMask),
        "Mixing the wrong type reference and graph"
    );
}

function getGraph(graphOrBuilder: TypeGraph | BaseGraphRewriteBuilder): TypeGraph {
    if (graphOrBuilder instanceof TypeGraph) {
        return graphOrBuilder;
    }
		
    return graphOrBuilder.originalGraph;
}

export function derefTypeRef(tref: TypeRef, graphOrBuilder: TypeGraph | BaseGraphRewriteBuilder): Type {
    const graph = getGraph(graphOrBuilder);
    assertTypeRefGraph(tref, graph);
    return graph.typeAtIndex(typeRefIndex(tref));
}

export function attributesForTypeRef(
    tref: TypeRef,
    graphOrBuilder: TypeGraph | BaseGraphRewriteBuilder
): TypeAttributes {
    const graph = getGraph(graphOrBuilder);
    assertTypeRefGraph(tref, graph);
    return graph.atIndex(typeRefIndex(tref))[1];
}

export function typeAndAttributesForTypeRef(
    tref: TypeRef,
    graphOrBuilder: TypeGraph | BaseGraphRewriteBuilder
): [Type, TypeAttributes] {
    const graph = getGraph(graphOrBuilder);
    assertTypeRefGraph(tref, graph);
    return graph.atIndex(typeRefIndex(tref));
}
