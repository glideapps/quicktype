"use strict";
/* tslint:disable */
//  This file was automatically generated and should not be edited.
Object.defineProperty(exports, "__esModule", { value: true });
// A Directive can be adjacent to many parts of the GraphQL language, a __DirectiveLocation describes one such possible adjacencies.
var __DirectiveLocation;
(function (__DirectiveLocation) {
    __DirectiveLocation["QUERY"] = "QUERY";
    __DirectiveLocation["MUTATION"] = "MUTATION";
    __DirectiveLocation["SUBSCRIPTION"] = "SUBSCRIPTION";
    __DirectiveLocation["FIELD"] = "FIELD";
    __DirectiveLocation["FRAGMENT_DEFINITION"] = "FRAGMENT_DEFINITION";
    __DirectiveLocation["FRAGMENT_SPREAD"] = "FRAGMENT_SPREAD";
    __DirectiveLocation["INLINE_FRAGMENT"] = "INLINE_FRAGMENT";
    __DirectiveLocation["SCHEMA"] = "SCHEMA";
    __DirectiveLocation["SCALAR"] = "SCALAR";
    __DirectiveLocation["OBJECT"] = "OBJECT";
    __DirectiveLocation["FIELD_DEFINITION"] = "FIELD_DEFINITION";
    __DirectiveLocation["ARGUMENT_DEFINITION"] = "ARGUMENT_DEFINITION";
    __DirectiveLocation["INTERFACE"] = "INTERFACE";
    __DirectiveLocation["UNION"] = "UNION";
    __DirectiveLocation["ENUM"] = "ENUM";
    __DirectiveLocation["ENUM_VALUE"] = "ENUM_VALUE";
    __DirectiveLocation["INPUT_OBJECT"] = "INPUT_OBJECT";
    __DirectiveLocation["INPUT_FIELD_DEFINITION"] = "INPUT_FIELD_DEFINITION"; // Location adjacent to an input object field definition.
})(__DirectiveLocation = exports.__DirectiveLocation || (exports.__DirectiveLocation = {}));
// An enum describing what kind of type a given `__Type` is.
var TypeKind;
(function (TypeKind) {
    TypeKind["SCALAR"] = "SCALAR";
    TypeKind["OBJECT"] = "OBJECT";
    TypeKind["INTERFACE"] = "INTERFACE";
    TypeKind["UNION"] = "UNION";
    TypeKind["ENUM"] = "ENUM";
    TypeKind["INPUT_OBJECT"] = "INPUT_OBJECT";
    TypeKind["LIST"] = "LIST";
    TypeKind["NON_NULL"] = "NON_NULL"; // Indicates this type is a non-null. `ofType` is a valid field.
})(TypeKind = exports.TypeKind || (exports.TypeKind = {}));
