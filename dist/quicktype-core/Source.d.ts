import { AnnotationData } from "./Annotation";
import { Name } from "./Naming";
export declare type Source = TextSource | NewlineSource | SequenceSource | TableSource | AnnotatedSource | NameSource | ModifiedSource;
export interface TextSource {
    kind: "text";
    text: string;
}
export interface NewlineSource {
    kind: "newline";
    indentationChange: number;
}
export interface SequenceSource {
    kind: "sequence";
    sequence: ReadonlyArray<Source>;
}
export interface TableSource {
    kind: "table";
    table: ReadonlyArray<ReadonlyArray<Source>>;
}
export interface AnnotatedSource {
    kind: "annotated";
    annotation: AnnotationData;
    source: Source;
}
export interface NameSource {
    kind: "name";
    named: Name;
}
export interface ModifiedSource {
    kind: "modified";
    modifier: (serialized: string) => string;
    source: Source;
}
export declare function newline(): NewlineSource;
export declare type Sourcelike = Source | string | Name | SourcelikeArray;
export interface SourcelikeArray extends Array<Sourcelike> {
}
export declare function sourcelikeToSource(sl: Sourcelike): Source;
export declare function annotated(annotation: AnnotationData, sl: Sourcelike): Source;
export declare function maybeAnnotated(doAnnotate: boolean, annotation: AnnotationData, sl: Sourcelike): Sourcelike;
export declare function modifySource(modifier: (serialized: string) => string, sl: Sourcelike): Sourcelike;
export interface Location {
    line: number;
    column: number;
}
export interface Span {
    start: Location;
    end: Location;
}
export interface Annotation {
    annotation: AnnotationData;
    span: Span;
}
export interface SerializedRenderResult {
    lines: string[];
    annotations: ReadonlyArray<Annotation>;
}
export declare function serializeRenderResult(rootSource: Source, names: ReadonlyMap<Name, string>, indentation: string): SerializedRenderResult;
export declare type MultiWord = {
    source: Sourcelike;
    needsParens: boolean;
};
export declare function singleWord(...source: Sourcelike[]): MultiWord;
export declare function multiWord(separator: Sourcelike, ...words: Sourcelike[]): MultiWord;
export declare function parenIfNeeded({ source, needsParens }: MultiWord): Sourcelike;
