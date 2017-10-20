"use strict";

export class Annotation {}

export class IssueAnnotation {
    constructor(readonly message) {}
}

export const anyTypeIssueAnnotation = new IssueAnnotation(
    "quicktype cannot infer this type because there is no data about it in the input."
);
export const nullTypeIssueAnnotation = new IssueAnnotation(
    "The only value for this in the input is null, which means you probably need a more complete input sample."
);
