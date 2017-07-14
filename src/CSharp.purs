module CSharp 
    ( renderCSharpClass
    ) where

import Prelude

import IR
import Doc

import Data.Foldable (for_)

renderTypeToCSharp :: IRType -> String
renderTypeToCSharp = case _ of
    IRNothing -> "object"
    IRNull -> "object"
    IRInteger -> "int"
    IRDouble -> "double"
    IRBool -> "bool"
    IRString -> "string"
    IRArray a -> renderTypeToCSharp a <> "[]"
    IRClass { name } -> name
    IRUnion _ -> "FIXME"

renderCSharpClass :: IRClassData -> Doc Unit
renderCSharpClass { name, properties } = do
    line $ words ["class", name]
    line "{"
    indent do
        for_ properties \p -> line do
            string "public "
            string $ renderTypeToCSharp p.typ
            words ["", p.name, "{ get; set; }"]
    line "}"
